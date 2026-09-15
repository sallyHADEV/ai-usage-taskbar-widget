using System;
using System.Collections.Generic;
using System.Threading;
using System.Runtime.InteropServices;
using System.Text;

namespace FluentFlyoutDocker
{
    class Program
    {
        [DllImport("user32.dll", EntryPoint = "FindWindowW", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll", EntryPoint = "FindWindowExW", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr GetParent(IntPtr hWnd);

        [DllImport("user32.dll", ExactSpelling = true)]
        static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
        const uint GA_PARENT = 1;

        [DllImport("user32.dll", SetLastError = true)]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

        [DllImport("user32.dll")]
        static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        static extern short GetAsyncKeyState(int vKey);

        const int VK_LBUTTON = 0x01;

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetProcessWindowStation(IntPtr hWinSta);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr MonitorFromRect(ref RECT lprc, uint dwFlags);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint GetDpiForWindow(IntPtr hWnd);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MONITORINFO
        {
            public uint cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        const uint MONITOR_DEFAULTTONEAREST = 2;

        const int GWL_STYLE = -16;
        const int GWL_EXSTYLE = -20;
        const int WS_POPUP = unchecked((int)0x80000000);
        const int WS_CHILD = 0x40000000;
        const int WS_EX_NOACTIVATE = 0x08000000;
        const int WS_EX_TOOLWINDOW = 0x00000080;
        const int WS_EX_APPWINDOW = 0x00040000;

        const uint SWP_NOSIZE = 0x0001;
        const uint SWP_NOMOVE = 0x0002;
        const uint SWP_NOZORDER = 0x0004;
        const uint SWP_NOACTIVATE = 0x0010;
        const uint SWP_FRAMECHANGED = 0x0020;
        const uint SWP_SHOWWINDOW = 0x0040;

        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        static readonly IntPtr HWND_TOP = IntPtr.Zero;

        static int GetLeftAnchor(IntPtr taskbarHwnd)
        {
            IntPtr startHwnd = FindWindowEx(taskbarHwnd, IntPtr.Zero, "Start", null);
            if (startHwnd == IntPtr.Zero)
            {
                startHwnd = FindWindow("Start", null);
            }

            if (startHwnd != IntPtr.Zero && IsWindow(startHwnd))
            {
                RECT r;
                if (GetWindowRect(startHwnd, out r))
                {
                    POINT pt = new POINT();
                    pt.X = r.Right;
                    pt.Y = r.Top;
                    if (ScreenToClient(taskbarHwnd, ref pt))
                    {
                        if (pt.X > 0) return pt.X;
                    }
                }
            }

            return 0;
        }

        static int GetRightAnchor(IntPtr taskbarHwnd, int taskbarClientWidth)
        {
            IntPtr trayHwnd = FindWindowEx(taskbarHwnd, IntPtr.Zero, "TrayNotifyWnd", null);
            if (trayHwnd != IntPtr.Zero && IsWindow(trayHwnd))
            {
                RECT trayRect;
                if (GetWindowRect(trayHwnd, out trayRect))
                {
                    POINT pt = new POINT();
                    pt.X = trayRect.Left;
                    pt.Y = trayRect.Top;
                    if (ScreenToClient(taskbarHwnd, ref pt))
                    {
                        if (pt.X > 0 && pt.X <= taskbarClientWidth)
                        {
                            return pt.X;
                        }
                    }
                }
            }

            return taskbarClientWidth;
        }

        static IntPtr ParseHwnd(string s)
        {
            if (string.IsNullOrEmpty(s)) return IntPtr.Zero;
            long val = s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
                ? Convert.ToInt64(s.Substring(2), 16)
                : Convert.ToInt64(s);
            return new IntPtr(val);
        }

        static int GetWindowDpi(IntPtr hWnd)
        {
            try
            {
                uint dpi = GetDpiForWindow(hWnd);
                if (dpi > 0) return (int)dpi;
            }
            catch
            {
                // 이전 Windows 버전 호환 폴백
            }
            return 96;
        }

        // 다중 모니터를 고려한 대상 작업표시줄 탐색
        static IntPtr FindTargetTaskbar(RECT? targetMonitorRect)
        {
            List<IntPtr> taskbars = new List<IntPtr>();

            EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
            {
                StringBuilder sb = new StringBuilder(64);
                GetClassName(hWnd, sb, sb.Capacity);
                string cls = sb.ToString();
                if (cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd")
                {
                    taskbars.Add(hWnd);
                }
                return true;
            }, IntPtr.Zero);

            if (taskbars.Count == 0)
            {
                return IntPtr.Zero;
            }

            // 모니터 영역이 지정된 경우 해당 모니터에 위치한 작업표시줄 선택
            if (targetMonitorRect.HasValue)
            {
                RECT monRect = targetMonitorRect.Value;
                IntPtr targetMon = MonitorFromRect(ref monRect, MONITOR_DEFAULTTONEAREST);

                for (int i = 0; i < taskbars.Count; i++)
                {
                    IntPtr tb = taskbars[i];
                    IntPtr tbMon = MonitorFromWindow(tb, MONITOR_DEFAULTTONEAREST);
                    if (tbMon == targetMon)
                    {
                        return tb;
                    }
                }
            }

            // 폴백: 메인 작업표시줄(Shell_TrayWnd) 우선
            for (int i = 0; i < taskbars.Count; i++)
            {
                StringBuilder sb = new StringBuilder(64);
                GetClassName(taskbars[i], sb, sb.Capacity);
                if (sb.ToString() == "Shell_TrayWnd")
                {
                    return taskbars[i];
                }
            }

            return taskbars[0];
        }

        static bool IsForegroundFullscreen(IntPtr widgetHwnd)
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;

            StringBuilder classNameBuf = new StringBuilder(256);
            GetClassName(fg, classNameBuf, classNameBuf.Capacity);
            string className = classNameBuf.ToString();

            if (className == "Progman" || className == "WorkerW" || className == "Shell_TrayWnd" || className == "Shell_SecondaryTrayWnd")
            {
                return false;
            }

            RECT winRect;
            if (!GetWindowRect(fg, out winRect)) return false;

            IntPtr hMon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);

            if (widgetHwnd != IntPtr.Zero && IsWindow(widgetHwnd))
            {
                IntPtr widgetMon = MonitorFromWindow(widgetHwnd, MONITOR_DEFAULTTONEAREST);
                if (widgetMon != hMon) return false;
            }

            MONITORINFO mi = new MONITORINFO();
            mi.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFO));
            if (!GetMonitorInfo(hMon, ref mi)) return false;

            return winRect.Left <= mi.rcMonitor.Left
                && winRect.Top <= mi.rcMonitor.Top
                && winRect.Right >= mi.rcMonitor.Right
                && winRect.Bottom >= mi.rcMonitor.Bottom;
        }

        static int RunAction(string[] args)
        {
            try
            {
                SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            }
            catch { }

            if (args.Length < 1) return 1;

            string action = args[0].ToLower();

            // ==========================================
            // 1. DOCK: 실제 작업표시줄에 child HWND로 도킹
            // 인자: dock <childHwnd> <width> <height> <align: right|left> <offset> <vOffset> [monLeft,monTop,monRight,monBottom]
            // ==========================================
            if (action == "dock" && args.Length >= 7)
            {
                IntPtr childHwnd = ParseHwnd(args[1]);
                if (!IsWindow(childHwnd))
                {
                    Console.WriteLine("INVALID_CHILD_HWND");
                    return 4;
                }

                double logicalWidth = double.Parse(args[2]);
                double logicalHeight = double.Parse(args[3]);
                string align = args[4].ToLower();
                double logicalOffset = double.Parse(args[5]);
                double logicalVOffset = double.Parse(args[6]);

                RECT? targetMonitorRect = null;
                if (args.Length >= 8 && !string.IsNullOrEmpty(args[7]))
                {
                    string[] parts = args[7].Split(',');
                    if (parts.Length == 4)
                    {
                        RECT r = new RECT();
                        r.Left = int.Parse(parts[0]);
                        r.Top = int.Parse(parts[1]);
                        r.Right = int.Parse(parts[2]);
                        r.Bottom = int.Parse(parts[3]);
                        targetMonitorRect = r;
                    }
                }

                IntPtr taskbarHwnd = FindTargetTaskbar(targetMonitorRect);
                if (taskbarHwnd == IntPtr.Zero || !IsWindow(taskbarHwnd))
                {
                    Console.WriteLine("TASKBAR_NOT_FOUND");
                    return 2;
                }

                // 도킹 전 Electron HWND의 실제 physical rect 획득 (DPI 재계산 왜곡 방지)
                RECT origRect;
                GetWindowRect(childHwnd, out origRect);
                int existingNativeWidth = origRect.Right - origRect.Left;

                // GetClientRect로 실제 Taskbar Client 크기 조회
                RECT tbClientRect;
                if (!GetClientRect(taskbarHwnd, out tbClientRect))
                {
                    Console.WriteLine("TASKBAR_CLIENT_RECT_FAILED");
                    return 3;
                }

                int taskbarClientWidth = tbClientRect.Right - tbClientRect.Left;
                int taskbarClientHeight = tbClientRect.Bottom - tbClientRect.Top;

                // 작업표시줄 DPI 스케일 감지
                int dpi = GetWindowDpi(taskbarHwnd);
                double scale = dpi / 96.0;

                // 너비 및 높이: Electron HWND의 실제 physical rect 읽기 (DPI 재계산 왜곡 방지)
                int widgetWidthPx = origRect.Right - origRect.Left;
                int widgetHeightPx = origRect.Bottom - origRect.Top;

                if (widgetWidthPx <= 0) widgetWidthPx = (int)Math.Round(logicalWidth * scale);
                if (widgetHeightPx <= 0) widgetHeightPx = (int)Math.Round(logicalHeight * scale);

                int physOffset = (int)Math.Round(logicalOffset * scale);
                int physVOffset = (int)Math.Round(logicalVOffset * scale);

                // 위치 계산: 세로는 작업표시줄 내부에서 HWND 자체를 수직 중앙 정렬
                int widgetY = ((taskbarClientHeight - widgetHeightPx) / 2) + physVOffset;

                int widgetX = 0;
                if (align == "left")
                {
                    int leftAnchor = GetLeftAnchor(taskbarHwnd);
                    widgetX = leftAnchor + physOffset;
                }
                else // right 정렬
                {
                    int rightAnchor = GetRightAnchor(taskbarHwnd, taskbarClientWidth);
                    widgetX = rightAnchor - physOffset - widgetWidthPx;
                }

                // 작업표시줄 내부 영역 클램핑
                if (widgetX < 0) widgetX = 0;
                if (widgetX + widgetWidthPx > taskbarClientWidth) widgetX = taskbarClientWidth - widgetWidthPx;

                // 1) Window Style 변환: WS_POPUP 제거, WS_CHILD 추가
                int style = GetWindowLong(childHwnd, GWL_STYLE);
                style = (style & ~WS_POPUP) | WS_CHILD;
                SetWindowLong(childHwnd, GWL_STYLE, style);

                // 2) Extended Style: ToolWindow 설정, WS_EX_NOACTIVATE 제거 (포커스/마우스 인터랙션 차단 방지)
                int exStyle = GetWindowLong(childHwnd, GWL_EXSTYLE);
                exStyle |= WS_EX_TOOLWINDOW;
                exStyle &= ~WS_EX_APPWINDOW;
                exStyle &= ~WS_EX_NOACTIVATE;
                SetWindowLong(childHwnd, GWL_EXSTYLE, exStyle);

                // 3) SetParent 호출
                SetParent(childHwnd, taskbarHwnd);

                // 4) SetParent 검증 (GetParent 또는 GetAncestor로 실제 부모 확인)
                IntPtr currentParent = GetParent(childHwnd);
                if (currentParent != taskbarHwnd)
                {
                    currentParent = GetAncestor(childHwnd, GA_PARENT);
                }

                if (currentParent != taskbarHwnd)
                {
                    int err = Marshal.GetLastWin32Error();
                    Console.WriteLine(string.Format("PARENT_VERIFY_FAILED:{0}", err));
                    return 5;
                }

                // 5) Client 좌표계로 위치 및 크기 설정 (HWND_TOP 사용, SWP_NOZORDER 제거로 child Z-order 최상위 승격, 높이는 widgetHeightPx)
                bool posOk = SetWindowPos(childHwnd, HWND_TOP, widgetX, widgetY, widgetWidthPx, widgetHeightPx,
                    SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);

                if (!posOk)
                {
                    int err = Marshal.GetLastWin32Error();
                    Console.WriteLine(string.Format("POSITION_FAILED:{0}", err));
                    return 6;
                }

                RECT afterRect;
                GetWindowRect(childHwnd, out afterRect);

                StringBuilder parentClassBuf = new StringBuilder(64);
                GetClassName(currentParent, parentClassBuf, parentClassBuf.Capacity);
                string parentClassName = parentClassBuf.ToString();

                // 디버깅 로그 출력
                Console.WriteLine(string.Format("Taskbar client = {0}x{1}", taskbarClientWidth, taskbarClientHeight));
                Console.WriteLine(string.Format("taskbarDpi = {0}", dpi));
                Console.WriteLine(string.Format("Electron HWND rect before docking = {0},{1} {2}x{3}",
                    origRect.Left, origRect.Top, origRect.Right - origRect.Left, origRect.Bottom - origRect.Top));
                Console.WriteLine(string.Format("Electron HWND rect after docking = {0},{1} {2}x{3}",
                    afterRect.Left, afterRect.Top, afterRect.Right - afterRect.Left, afterRect.Bottom - afterRect.Top));
                Console.WriteLine(string.Format("Widget client y={0} height={1}", widgetY, widgetHeightPx));
                Console.WriteLine(string.Format("Parent={0}", parentClassName));
                Console.WriteLine(string.Format("DOCKED_OK taskbar:0x{0:X} widget:0x{1:X} client:{2},{3},{4},{5} screen:{6},{7},{8},{9} dpi:{10}",
                    taskbarHwnd.ToInt64(), childHwnd.ToInt64(), widgetX, widgetY, widgetWidthPx, widgetHeightPx,
                    afterRect.Left, afterRect.Top, afterRect.Right - afterRect.Left, afterRect.Bottom - afterRect.Top, dpi));

                return 0;
            }

            // ==========================================
            // 2. UNDOCK: 작업표시줄에서 분리하여 일반 top-level window로 복원
            // 인자: undock <childHwnd>
            // ==========================================
            else if (action == "undock" && args.Length >= 2)
            {
                IntPtr childHwnd = ParseHwnd(args[1]);
                if (!IsWindow(childHwnd))
                {
                    Console.WriteLine("INVALID_CHILD_HWND");
                    return 4;
                }

                // 부모 분리
                SetParent(childHwnd, IntPtr.Zero);

                // 스타일 복원: WS_CHILD 제거, WS_POPUP 복원
                int style = GetWindowLong(childHwnd, GWL_STYLE);
                style = (style & ~WS_CHILD) | WS_POPUP;
                SetWindowLong(childHwnd, GWL_STYLE, style);

                int exStyle = GetWindowLong(childHwnd, GWL_EXSTYLE);
                exStyle &= ~WS_EX_TOOLWINDOW;
                exStyle &= ~WS_EX_NOACTIVATE;
                SetWindowLong(childHwnd, GWL_EXSTYLE, exStyle);

                SetWindowPos(childHwnd, IntPtr.Zero, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);

                Console.WriteLine("UNDOCKED_OK");
                return 0;
            }

            // ==========================================
            // 3. CHECKDOCK: 1~2초 주기 경량 헬스체크
            // 인자: checkdock <childHwnd> [expectedTaskbarHwnd]
            // ==========================================
            else if (action == "checkdock" && args.Length >= 2)
            {
                IntPtr childHwnd = ParseHwnd(args[1]);
                if (!IsWindow(childHwnd))
                {
                    Console.WriteLine("INVALID_WINDOW");
                    return 1;
                }

                IntPtr parentHwnd = GetParent(childHwnd);
                if (parentHwnd == IntPtr.Zero || !IsWindow(parentHwnd))
                {
                    parentHwnd = GetAncestor(childHwnd, GA_PARENT);
                }

                if (parentHwnd == IntPtr.Zero || !IsWindow(parentHwnd))
                {
                    Console.WriteLine("NO_PARENT");
                    return 2;
                }

                if (args.Length >= 3)
                {
                    IntPtr expectedHwnd = ParseHwnd(args[2]);
                    if (expectedHwnd != IntPtr.Zero && parentHwnd != expectedHwnd)
                    {
                        Console.WriteLine("PARENT_MISMATCH");
                        return 3;
                    }
                }

                StringBuilder sb = new StringBuilder(64);
                GetClassName(parentHwnd, sb, sb.Capacity);
                string cls = sb.ToString();
                if (cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd")
                {
                    Console.WriteLine("DOCK_HEALTHY");
                    return 0;
                }

                Console.WriteLine("NOT_TASKBAR_PARENT");
                return 4;
            }

            // ==========================================
            // 4. GETSCREENRECT: 팝업 앵커용 위젯 실제 화면 절대 좌표 조회
            // 인자: getscreenrect <hwnd>
            // ==========================================
            else if (action == "getscreenrect" && args.Length >= 2)
            {
                IntPtr hwnd = ParseHwnd(args[1]);
                if (!IsWindow(hwnd))
                {
                    Console.WriteLine("INVALID_HWND");
                    return 1;
                }

                RECT r;
                if (!GetWindowRect(hwnd, out r))
                {
                    Console.WriteLine("GET_RECT_FAILED");
                    return 2;
                }

                Console.WriteLine(string.Format("{0},{1},{2},{3}", r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top));
                return 0;
            }

            // ==========================================
            // 5. STAYTOP: (플로팅 모드 전용)
            // ==========================================
            else if (action == "staytop" && args.Length >= 2)
            {
                IntPtr childHwnd = ParseHwnd(args[1]);
                if (!IsWindow(childHwnd))
                {
                    Console.WriteLine("INVALID_CHILD_HWND");
                    return 4;
                }

                int interval = 600;
                if (args.Length >= 3) int.TryParse(args[2], out interval);
                if (interval < 50) interval = 50;

                SetWindowPos(childHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                Console.WriteLine("STAYTOP_STARTED");

                while (IsWindow(childHwnd))
                {
                    SetWindowPos(childHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    Thread.Sleep(interval);
                }

                return 0;
            }

            // ==========================================
            // 6. FSWATCH: (플로팅 모드 전용 전체화면 감지)
            // ==========================================
            else if (action == "fswatch")
            {
                int interval = 1000;
                if (args.Length >= 2) int.TryParse(args[1], out interval);
                if (interval < 200) interval = 200;

                IntPtr widgetHwnd = args.Length >= 3 ? ParseHwnd(args[2]) : IntPtr.Zero;

                bool lastState = false;
                bool first = true;
                while (true)
                {
                    bool current = IsForegroundFullscreen(widgetHwnd);
                    if (first || current != lastState)
                    {
                        Console.WriteLine(current ? "1" : "0");
                        Console.Out.Flush();
                        lastState = current;
                        first = false;
                    }
                    Thread.Sleep(interval);
                }
            }

            // ==========================================
            // 7. CLICKWATCH: (도킹 모드 전용 네이티브 클릭 감지)
            // 인자: clickwatch <childHwnd>
            // ==========================================
            else if (action == "clickwatch" && args.Length >= 2)
            {
                IntPtr widget = ParseHwnd(args[1]);
                if (!IsWindow(widget))
                {
                    Console.WriteLine("INVALID_WINDOW");
                    return 1;
                }

                bool previousDown = false;

                while (IsWindow(widget))
                {
                    bool down = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;

                    // mouse-up 순간 감지
                    if (!down && previousDown)
                    {
                        POINT p;
                        if (GetCursorPos(out p))
                        {
                            RECT r;
                            if (GetWindowRect(widget, out r))
                            {
                                if (p.X >= r.Left && p.X < r.Right && p.Y >= r.Top && p.Y < r.Bottom)
                                {
                                    Console.WriteLine("CLICK");
                                    Console.Out.Flush();
                                }
                            }
                        }
                    }

                    previousDown = down;
                    Thread.Sleep(16);
                }

                return 0;
            }

            return 3;
        }

        static int Main(string[] args)
        {
            int exitCode = 0;
            try
            {
                try
                {
                    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                }
                catch { }

                try
                {
                    IntPtr hWinSta = OpenWindowStation("WinSta0", false, 0x000F037F);
                    if (hWinSta != IntPtr.Zero)
                    {
                        SetProcessWindowStation(hWinSta);
                    }
                }
                catch { }

                IntPtr hDesk = OpenDesktop("Default", 0, false, 0x000F01FF);
                if (hDesk == IntPtr.Zero)
                {
                    hDesk = OpenDesktop("default", 0, false, 0x000F01FF);
                }

                if (hDesk != IntPtr.Zero)
                {
                    Thread t = new Thread(delegate ()
                    {
                        SetThreadDesktop(hDesk);
                        exitCode = RunAction(args);
                    });
                    t.Start();
                    t.Join();
                }
                else
                {
                    exitCode = RunAction(args);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERROR: " + ex.Message);
                return 99;
            }

            return exitCode;
        }
    }
}
