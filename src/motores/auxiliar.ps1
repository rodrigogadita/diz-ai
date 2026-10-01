# Auxiliar do Diz Ai (Windows). Fica aberto e conversa por stdin/stdout, uma linha por comando.
# Comandos: winh | gravar | parar <arquivo.wav> | cancelar | medir | parar_medir
#           mic_estado | mic_liberar | fala_online | ligar_fala_online | ditado_windows
# Enquanto mede, escreve sozinho linhas "nivel <pico 0-32767> <ditado do Windows ouvindo 0|1>".
# Arquivo so com ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System; using System.Text; using System.Threading; using System.Runtime.InteropServices;
using Microsoft.Win32;

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int NotImpl1(); [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f1(); int f2(); int f3(); int f4();
  int SetMasterVolumeLevelScalar(float level, Guid ctx); int f6();
  int GetMasterVolumeLevelScalar(out float level);
  int f8(); int f9(); int f10(); int f11();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
  int GetMute(out bool mute);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

public static class DizAi {
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern int mciSendString(string cmd, StringBuilder ret, int len, IntPtr cb);
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern bool mciGetErrorString(int err, StringBuilder buf, int len);

  // ---------- Win+H ----------
  static bool Preso(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
  // Espera soltar Ctrl/Alt/Shift do atalho, senao o Windows recebe Ctrl+Alt+Win+H e ignora.
  public static string WinH() {
    for (int i = 0; i < 70 && (Preso(0x10) || Preso(0x11) || Preso(0x12)); i++) Thread.Sleep(30);
    keybd_event(0x5B, 0, 0, UIntPtr.Zero); keybd_event(0x48, 0, 0, UIntPtr.Zero);
    keybd_event(0x48, 0, 2, UIntPtr.Zero); keybd_event(0x5B, 0, 2, UIntPtr.Zero);
    return "ok";
  }

  // ---------- gravacao para o Whisper (MCI) ----------
  static string Mci(string c) {
    int r = mciSendString(c, new StringBuilder(128), 128, IntPtr.Zero);
    if (r == 0) return "ok";
    var e = new StringBuilder(256); mciGetErrorString(r, e, 256); return "erro " + e;
  }
  public static string Gravar() {
    Mci("close dizai");
    string r = Mci("open new Type waveaudio Alias dizai"); if (r != "ok") return r;
    r = Mci("set dizai bitspersample 16 channels 1 samplespersec 16000 bytespersec 32000 alignment 2"); if (r != "ok") return r;
    return Mci("record dizai");
  }
  public static string Parar(string arquivo) {
    Mci("stop dizai");
    string r = Mci("save dizai \"" + arquivo + "\"");
    Mci("close dizai");
    return r;
  }
  public static string Cancelar() { Mci("stop dizai"); Mci("close dizai"); return "ok"; }

  // ---------- microfone padrao: mudo e volume ----------
  static IAudioEndpointVolume Volume() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(1, 0, out d)); // 1 = captura
    var iid = typeof(IAudioEndpointVolume).GUID; object o;
    Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static string MicEstado() {
    try { var v = Volume(); float l; bool m; v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m); return "mudo=" + (m ? 1 : 0) + " volume=" + (int)Math.Round(l * 100); }
    catch (Exception e) { return "erro sem microfone padrao (" + e.Message + ")"; }
  }
  public static string MicLiberar() {
    try { var v = Volume(); float l; v.SetMute(false, Guid.Empty); v.GetMasterVolumeLevelScalar(out l); if (l < 0.8f) v.SetMasterVolumeLevelScalar(0.8f, Guid.Empty); return MicEstado(); }
    catch (Exception e) { return "erro " + e.Message; }
  }

  // ---------- privacidade de fala e estado do ditado do Windows ----------
  const string FALA = @"Software\Microsoft\Speech_OneCore\Settings\OnlineSpeechPrivacy";
  const string CONSENT = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
  public static string FalaOnline() {
    using (var k = Registry.CurrentUser.OpenSubKey(FALA)) { object v = k == null ? null : k.GetValue("HasAccepted"); return (v != null && Convert.ToInt32(v) == 1) ? "1" : "0"; }
  }
  public static string LigarFalaOnline() {
    using (var k = Registry.CurrentUser.CreateSubKey(FALA)) { k.SetValue("HasAccepted", 1, RegistryValueKind.DWord); }
    return FalaOnline();
  }
  // O Windows marca o microfone "em uso" (LastUsedTimeStop = 0) enquanto a digitacao por voz escuta.
  public static bool DitadoOuvindo() {
    try {
      using (var k = Registry.CurrentUser.OpenSubKey(CONSENT)) {
        if (k == null) return false;
        foreach (var nome in k.GetSubKeyNames()) {
          if (nome.IndexOf("Client.CBS", StringComparison.OrdinalIgnoreCase) < 0 && nome.IndexOf("TextInput", StringComparison.OrdinalIgnoreCase) < 0) continue;
          using (var s = k.OpenSubKey(nome)) {
            object ini = s.GetValue("LastUsedTimeStart"), fim = s.GetValue("LastUsedTimeStop");
            if (ini != null && Convert.ToInt64(ini) > 0 && fim != null && Convert.ToInt64(fim) == 0) return true;
          }
        }
      }
    } catch { }
    return false;
  }

  // ---------- medidor de nivel (waveIn, nao grava nada) ----------
  [StructLayout(LayoutKind.Sequential)] struct Fmt { public ushort tag, ch; public uint rate, bps; public ushort align, bits, cb; }
  [StructLayout(LayoutKind.Sequential)] struct Hdr { public IntPtr data; public uint len, rec; public IntPtr user; public uint flags, loops; public IntPtr next, res; }
  [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr h, uint dev, ref Fmt f, IntPtr cb, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInStart(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInReset(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInClose(IntPtr h);

  static volatile bool medindo = false;
  static Thread fio = null;

  public static string Medir() {
    if (medindo) return "ok";
    medindo = true;
    fio = new Thread(LacoMedidor); fio.IsBackground = true; fio.Start();
    return "ok";
  }
  public static string PararMedir() {
    medindo = false;
    if (fio != null) { fio.Join(1000); fio = null; }
    return "ok";
  }

  static void LacoMedidor() {
    var f = new Fmt { tag = 1, ch = 1, rate = 16000, bps = 32000, align = 2, bits = 16, cb = 0 };
    IntPtr h;
    if (waveInOpen(out h, 0xFFFFFFFF, ref f, IntPtr.Zero, IntPtr.Zero, 0) != 0) { Console.Out.WriteLine("nivel -1 0"); medindo = false; return; }
    int n = 4, tam = 2560, sz = Marshal.SizeOf(typeof(Hdr)); // 80 ms por janela
    var hs = new IntPtr[n];
    for (int i = 0; i < n; i++) {
      var hd = new Hdr { data = Marshal.AllocHGlobal(tam), len = (uint)tam };
      hs[i] = Marshal.AllocHGlobal(sz); Marshal.StructureToPtr(hd, hs[i], false);
      waveInPrepareHeader(h, hs[i], sz); waveInAddBuffer(h, hs[i], sz);
    }
    waveInStart(h);
    int voltas = 0; bool ouvindo = DitadoOuvindo();
    while (medindo) {
      for (int i = 0; i < n && medindo; i++) {
        var hd = (Hdr)Marshal.PtrToStructure(hs[i], typeof(Hdr));
        if ((hd.flags & 1) == 0) continue; // WHDR_DONE
        int pico = 0; var buf = new short[hd.rec / 2]; Marshal.Copy(hd.data, buf, 0, buf.Length);
        foreach (var s in buf) { int a = s == short.MinValue ? 32767 : Math.Abs((int)s); if (a > pico) pico = a; }
        if (++voltas % 4 == 0) ouvindo = DitadoOuvindo(); // registro a cada ~320 ms
        Console.Out.WriteLine("nivel " + pico + " " + (ouvindo ? 1 : 0));
        waveInUnprepareHeader(h, hs[i], sz); hd.flags = 0; Marshal.StructureToPtr(hd, hs[i], false);
        waveInPrepareHeader(h, hs[i], sz); waveInAddBuffer(h, hs[i], sz);
      }
      Thread.Sleep(10);
    }
    waveInReset(h);
    for (int i = 0; i < n; i++) {
      waveInUnprepareHeader(h, hs[i], sz);
      var hd = (Hdr)Marshal.PtrToStructure(hs[i], typeof(Hdr));
      Marshal.FreeHGlobal(hd.data); Marshal.FreeHGlobal(hs[i]);
    }
    waveInClose(h);
  }
}
"@

[Console]::Out.WriteLine('pronto')
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($l -eq $null) { break }
  try {
    if ($l -eq 'winh') { $r = [DizAi]::WinH() }
    elseif ($l -eq 'gravar') { $r = [DizAi]::Gravar() }
    elseif ($l.StartsWith('parar ')) { $r = [DizAi]::Parar($l.Substring(6)) }
    elseif ($l -eq 'cancelar') { $r = [DizAi]::Cancelar() }
    elseif ($l -eq 'medir') { $r = [DizAi]::Medir() }
    elseif ($l -eq 'parar_medir') { $r = [DizAi]::PararMedir() }
    elseif ($l -eq 'mic_estado') { $r = [DizAi]::MicEstado() }
    elseif ($l -eq 'mic_liberar') { $r = [DizAi]::MicLiberar() }
    elseif ($l -eq 'fala_online') { $r = [DizAi]::FalaOnline() }
    elseif ($l -eq 'ligar_fala_online') { $r = [DizAi]::LigarFalaOnline() }
    elseif ($l -eq 'ditado_windows') { $r = [string]([int][DizAi]::DitadoOuvindo()) }
    else { $r = 'erro comando desconhecido' }
  } catch { $r = 'erro ' + $_.Exception.Message }
  [Console]::Out.WriteLine("r " + $r)
}
[DizAi]::PararMedir() | Out-Null
[DizAi]::Cancelar() | Out-Null
