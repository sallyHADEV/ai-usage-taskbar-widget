using System;
using System.Threading;
using System.Runtime.InteropServices;

namespace FluentFlyoutDocker
{
    class Program
    {
        [DllImport("user32.dll", EntryPoint = "FindWindowW", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

        [DllImport("user32.dll", SetLastError = true)]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);

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

        const uint SWP_NOSIZE = 0x0001;
        const uint SWP_NOMOVE = 0x0002;
        const uint SWP_NOZORDER = 0x0004;
        const uint SWP_NOACTIVATE = 0x0010;
        const uint SWP_FRAMECHANGED = 0x0020;
        const uint SWP_SHOWWINDOW = 0x0040;

        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

        static IntPtr ParseHwnd(string s)
        {
            long val = s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
                ? Convert.ToInt64(s.Substring(2), 16)
                : Convert.ToInt64(s);
            return new IntPtr(val);
        }

        static IntPtr GetTaskbarHandle()
        {
            IntPtr hwnd = FindWindow("Shell_TrayWnd", null);
            if (hwnd == IntPtr.Zero)
            {
                hwnd = FindWindow("Shell_SecondaryTrayWnd", null);
            }
            return hwnd;
        }

        // 현재 포그라운드 창이 "위젯이 있는 모니터"를 전체 화면으로 덮고 있는지 판별.
        // widgetHwnd가 주어지면 포그라운드 창과 위젯이 같은 모니터에 있을 때만 전체화면으로 취급
        // (다른 모니터에서 전체화면 앱에 포커스가 가도 위젯이 사라지지 않도록)
        static bool IsForegroundFullscreen(IntPtr widgetHwnd)
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;

            var classNameBuf = new System.Text.StringBuilder(256);
            GetClassName(fg, classNameBuf, classNameBuf.Capacity);
            string className = classNameBuf.ToString();
            // 바탕화면/탐색기/작업표시줄 자체는 전체화면으로 취급하지 않음
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
            if (args.Length < 1) return 1;

            string action = args[0].ToLower();

            if (action == "staytop" && args.Length >= 2)
            {
                long childHwndVal;
                if (args[1].StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                    childHwndVal = Convert.ToInt64(args[1].Substring(2), 16);
                else
                    childHwndVal = Convert.ToInt64(args[1]);

                IntPtr childHwnd = new IntPtr(childHwndVal);
                if (!IsWindow(childHwnd))
                {
                    Console.WriteLine("INVALID_CHILD_HWND");
                    return 4;
                }

                int interval = 40;
                if (args.Length >= 3) int.TryParse(args[2], out interval);
                if (interval < 10) interval = 10;

                // 초기 HWND_TOPMOST 설정 (SWP_NOACTIVATE 플래그로 포커스 가로채지 않고 최상위 유지)
                SetWindowPos(childHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

                Console.WriteLine("STAYTOP_STARTED");

                // 3. 무결점 Z-Order 유지 루프
                while (IsWindow(childHwnd))
                {
                    SetWindowPos(childHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    Thread.Sleep(interval);
                }

                return 0;
            }
            else if (action == "dock" && args.Length >= 6)
            {
                long childHwndVal;
                if (args[1].StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                    childHwndVal = Convert.ToInt64(args[1].Substring(2), 16);
                else
                    childHwndVal = Convert.ToInt64(args[1]);

                int x = int.Parse(args[2]);
                int y = int.Parse(args[3]);
                int width = int.Parse(args[4]);
                int height = int.Parse(args[5]);

                IntPtr childHwnd = new IntPtr(childHwndVal);
                if (!IsWindow(childHwnd))
                {
                    Console.WriteLine("INVALID_CHILD_HWND");
                    return 4;
                }

                IntPtr taskbarHwnd = GetTaskbarHandle();
                if (taskbarHwnd == IntPtr.Zero)
                {
                    Console.WriteLine("TASKBAR_NOT_FOUND");
                    return 2;
                }

                // 스타일 변환 및 NOACTIVATE
                int style = GetWindowLong(childHwnd, GWL_STYLE);
                style = (style & ~WS_POPUP) | WS_CHILD;
                SetWindowLong(childHwnd, GWL_STYLE, style);

                int exStyle = GetWindowLong(childHwnd, GWL_EXSTYLE);
                exStyle |= WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
                SetWindowLong(childHwnd, GWL_EXSTYLE, exStyle);

                SetParent(childHwnd, taskbarHwnd);
                SetWindowPos(childHwnd, IntPtr.Zero, x, y, width, height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);

                Console.WriteLine("DOCKED_OK");
                return 0;
            }
            else if (action == "setpos" && args.Length >= 6)
            {
                long childHwndVal;
                if (args[1].StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                    childHwndVal = Convert.ToInt64(args[1].Substring(2), 16);
                else
                    childHwndVal = Convert.ToInt64(args[1]);

                int x = int.Parse(args[2]);
                int y = int.Parse(args[3]);
                int width = int.Parse(args[4]);
                int height = int.Parse(args[5]);

                IntPtr childHwnd = new IntPtr(childHwndVal);
                SetWindowPos(childHwnd, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
                Console.WriteLine("SETPOS_OK");
                return 0;
            }
            else if (action == "isfgfullscreen")
            {
                IntPtr widgetHwnd = args.Length >= 2 ? ParseHwnd(args[1]) : IntPtr.Zero;
                Console.WriteLine(IsForegroundFullscreen(widgetHwnd) ? "1" : "0");
                return 0;
            }
            else if (action == "fswatch")
            {
                // 새 프로세스를 매번 띄우지 않고 하나의 상주 프로세스가 폴링하며 상태가 바뀔 때만 stdout에 보고
                // (Electron에서 짧은 주기로 반복 spawn하면 .NET 프로세스 기동 비용 때문에 커서 busy 현상 유발)
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
            else if (action == "gettaskbar")
            {
                IntPtr taskbarHwnd = GetTaskbarHandle();
                if (taskbarHwnd == IntPtr.Zero)
                {
                    Console.WriteLine("TASKBAR_NOT_FOUND");
                    return 2;
                }
                RECT r;
                GetWindowRect(taskbarHwnd, out r);
                Console.WriteLine(string.Format("{0},{1},{2},{3}", r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top));
                return 0;
            }

            return 3;
        }

        static int Main(string[] args)
        {
            int exitCode = 0;
            try
            {
                IntPtr hDesk = OpenDesktop("default", 0, false, 0x01FF);
                if (hDesk != IntPtr.Zero)
                {
                    Thread t = new Thread(() =>
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
