# Q1-only Windows containment adapter. Input and command arguments are JSON, never shell text.
# @spec docs/architecture/VERIFICATION-POLICY.md
# @tested tools/tests/verification-process-win.test.mjs
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
public static class Q1Job {
    // Console.In.ReadLineAsync itself blocks; isolate the synchronous read on a worker.
    public static Task<string> Control() { return Task.Run(() => Console.ReadLine()); }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, uint length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool CloseHandle(IntPtr handle);
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public static IntPtr Create() {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        Check(job != IntPtr.Zero);
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE only; neither breakaway flag is permitted.
        try { Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>())); }
        catch { CloseHandle(job); throw; }
        return job;
    }
    public static void Bind(IntPtr job, IntPtr process) { Check(AssignProcessToJobObject(job, process)); }
    public static void Stop(IntPtr job) { Check(TerminateJobObject(job, 1)); }
    public static void Close(IntPtr job) { Check(CloseHandle(job)); }
    public static uint Active(IntPtr job) {
        int size = Marshal.SizeOf<Accounting>();
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            Check(QueryInformationJobObject(job, 1, buffer, (uint)size, IntPtr.Zero));
            return Marshal.PtrToStructure<Accounting>(buffer).ActiveProcesses;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    public static long[] Members(IntPtr job) {
        // Bounded inventory. Overflow is an error, never proof of an empty job.
        int size = 8 + 4096 * IntPtr.Size;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            Check(QueryInformationJobObject(job, 3, buffer, (uint)size, IntPtr.Zero));
            int count = Marshal.ReadInt32(buffer, 4);
            if (count < 0 || count > 4096) throw new InvalidOperationException("MEMBER_LIMIT");
            long[] ids = new long[count];
            for (int i = 0; i < count; i++) ids[i] = Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
            return ids;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
}
'@

$payload = [Console]::ReadLine()
if (-not $payload) { exit 1 }
$config = $payload | ConvertFrom-Json
$result = [ordered]@{
    status = $null; signal = $null; error = $null
    lifecycle = [ordered]@{
        containment = 'NOT_BOUND'; cleanup = 'UNVERIFIED'; reason = 'STARTING'
        limits = 'KILL_ON_JOB_CLOSE_NO_BREAKAWAY'; bootstrapPid = $null
        observedMembers = @(); activeAtCleanup = $null; remainingActive = $null
        executionDurationMs = 0; cleanupDurationMs = 0
    }
}
function Save-Result {
    [IO.File]::WriteAllText($config.resultPath + '.tmp', ($result | ConvertTo-Json -Depth 6))
    [IO.File]::Move($config.resultPath + '.tmp', $config.resultPath, $true)
}
$job = [IntPtr]::Zero
$process = $null
$started = $false
$bound = $false
$outCopy = $null
$errCopy = $null
$elapsed = [Diagnostics.Stopwatch]::new()
$members = [Collections.Generic.HashSet[long]]::new()
Save-Result
try {
    if ($config.timeout -le 0 -or $config.timeout -gt 600000) { throw 'INVALID_TIMEOUT' }
    $job = [Q1Job]::Create()
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $config.command
    $info.WorkingDirectory = $config.cwd
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.ArgumentList.Add($config.bootstrap)
    $info.ArgumentList.Add('--process-bootstrap')
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    $started = $process.Start()
    if (-not $started) { throw 'BOOTSTRAP_SPAWN_FAILED' }
    $result.lifecycle.bootstrapPid = $process.Id
    $outCopy = $process.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
    $errCopy = $process.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
    [Q1Job]::Bind($job, $process.Handle)
    $bound = $true
    $result.lifecycle.containment = 'BOUND'
    [void]$members.Add([long]$process.Id)
    $result.lifecycle.reason = 'RUNNING'
    Save-Result
    $control = [Q1Job]::Control()
    # No command can launch until Bind has succeeded; EOF or startup expiry closes the bootstrap.
    $process.StandardInput.WriteLine($payload)
    $process.StandardInput.Flush()
    $elapsed.Start()
    while ($true) {
        foreach ($member in [Q1Job]::Members($job)) { [void]$members.Add($member) }
        if ($control.IsCompleted) {
            $result.lifecycle.reason = 'CANCELLED'
            $result.error = @{ code = 'CANCELLED' }
            break
        }
        if ($process.HasExited) {
            $result.status = $process.ExitCode
            $result.lifecycle.reason = 'EXIT'
            break
        }
        if ($elapsed.ElapsedMilliseconds -ge $config.timeout) {
            $result.lifecycle.reason = 'TIMEOUT'
            $result.error = @{ code = 'ETIMEDOUT' }
            break
        }
        [Threading.Thread]::Sleep(40)
    }
} catch {
    $result.lifecycle.reason = if ($bound) { 'SUPERVISOR_ERROR' } else { 'CONTAINMENT_FAILED' }
    $result.error = @{ code = $result.lifecycle.reason }
    # Do not serialize exception messages, environment or arbitrary command payloads.
} finally {
    $elapsed.Stop()
    $result.lifecycle.executionDurationMs = $elapsed.ElapsedMilliseconds
    $cleanup = [Diagnostics.Stopwatch]::StartNew()
    try {
        if ($job -ne [IntPtr]::Zero) {
            foreach ($member in [Q1Job]::Members($job)) { [void]$members.Add($member) }
            $result.lifecycle.activeAtCleanup = [Q1Job]::Active($job)
            [Q1Job]::Stop($job)
        }
        # A failed Bind leaves only our blocked bootstrap. Use its owned handle, never a PID lookup.
        if ($started -and -not $bound -and -not $process.HasExited) { $process.Kill() }
        do {
            $active = if ($job -eq [IntPtr]::Zero) { 0 } else { [Q1Job]::Active($job) }
            $bootstrapStopped = -not $started -or $process.HasExited
            if ($active -eq 0 -and $bootstrapStopped) { break }
            [Threading.Thread]::Sleep(20)
        } while ($cleanup.ElapsedMilliseconds -lt 3000)
        $result.lifecycle.remainingActive = $active
        if ($active -eq 0 -and $bootstrapStopped) { $result.lifecycle.cleanup = 'VERIFIED' }
    } catch { $result.lifecycle.cleanup = 'UNVERIFIED' }
    finally {
        if ($job -ne [IntPtr]::Zero) {
            try { [Q1Job]::Close($job) } catch { $result.lifecycle.cleanup = 'UNVERIFIED' }
        }
    }
    $result.lifecycle.cleanupDurationMs = $cleanup.ElapsedMilliseconds
    $result.lifecycle.observedMembers = @($members | Sort-Object)
    foreach ($copy in @($outCopy, $errCopy)) {
        if ($null -ne $copy) {
            try {
                if (-not $copy.Wait(1000)) { $result.error = @{ code = 'OUTPUT_DRAIN_UNVERIFIED' } }
            } catch { $result.error = @{ code = 'OUTPUT_DRAIN_FAILED' } }
        }
    }
    if ($null -ne $process) { $process.Dispose() }
    Save-Result
}
if ($result.error -or $result.status -ne 0 -or $result.lifecycle.cleanup -ne 'VERIFIED') { exit 1 }
exit 0
