// 编写人：Aurora
// 性能监控
'use strict';

(function () {
  const {
    formatDateTime,
    formatBytes,
    formatDuration,
    toast,
    showError
  } = window.AdminApp.utils;

  const METRICS_SAMPLE_SECONDS = 5;
  let metricsRunning = false;
  let metricsCountdownTimer = null;
  let hardwareLoaded = false;
  let hardwareLoading = false;

  function initPerformanceMonitor() {
    const button = document.getElementById('metricsRefreshBtn');
    if (!button) return;

    const loadHardware = () => {
      loadHardwareSummary(false);
    };
    document.getElementById('otherPerformanceFeatureTab')?.addEventListener('click', loadHardware);
    document.querySelector('[data-main-page="otherAssistantPage"]')?.addEventListener('click', loadHardware);

    button.addEventListener('click', runMetricsSample);
  }

  async function runMetricsSample() {
    if (metricsRunning) return;
    metricsRunning = true;
    setMetricsBusy(true);

    try {
      const [response, hardwareResponse] = await Promise.all([
        fetch('/api/system/metrics?windowMs=5000'),
        fetch('/api/system/hardware?includeTemperatures=true')
      ]);
      const [payload, hardwarePayload] = await Promise.all([response.json(), hardwareResponse.json()]);
      if (!payload.ok) throw new Error(payload.error || '性能检测失败');
      renderMetrics(payload.data);
      if (hardwarePayload.ok) renderHardwareSummary(hardwarePayload.data, true);
      else document.getElementById('hardwareSummaryStatus').textContent = '硬件温度暂不可用，不影响性能检测';
      toast('性能检测完成');
    } catch (error) {
      showError(error);
      renderMetricsError(error);
    } finally {
      metricsRunning = false;
      setMetricsBusy(false);
    }
  }

  function setMetricsBusy(isBusy) {
    const button = document.getElementById('metricsRefreshBtn');
    const status = document.getElementById('metricsStatus');

    button.disabled = isBusy;
    button.textContent = isBusy ? '检测中' : '开始检测';
    if (isBusy) {
      status.textContent = '正在采样最近 5 秒';
      startMetricsCountdown();
    } else {
      resetMetricsCountdown();
    }
  }

  function startMetricsCountdown() {
    const countdown = document.getElementById('metricsCountdown');
    const countdownValue = document.getElementById('metricsCountdownValue');
    if (!countdown || !countdownValue) return;

    resetMetricsCountdown();
    const startedAt = Date.now();
    countdown.classList.add('is-running');
    metricsCountdownTimer = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const remainingSeconds = Math.max(0, METRICS_SAMPLE_SECONDS - elapsedSeconds);
      countdownValue.textContent = String(remainingSeconds);
      if (remainingSeconds === 0) {
        clearInterval(metricsCountdownTimer);
        metricsCountdownTimer = null;
      }
    }, 200);
  }

  function resetMetricsCountdown() {
    if (metricsCountdownTimer !== null) {
      clearInterval(metricsCountdownTimer);
      metricsCountdownTimer = null;
    }
    const countdown = document.getElementById('metricsCountdown');
    const countdownValue = document.getElementById('metricsCountdownValue');
    countdown?.classList.remove('is-running');
    if (countdownValue) countdownValue.textContent = String(METRICS_SAMPLE_SECONDS);
  }

  function renderMetrics(metrics) {
    const system = metrics.system || {};
    const app = metrics.process || {};
    document.getElementById('metricsStatus').textContent = '最近 5 秒检测完成';
    setMetric('metricSystemCpu', system.cpuPercent, '5 秒平均值');
    setMetric(
      'metricSystemGpu',
      system.gpuAvailable ? system.gpuPercent : null,
      system.gpuAvailable ? '5 秒平均值' : (system.gpuMessage || '不可用')
    );
    setMetric(
      'metricSystemMemory',
      system.memoryPercent,
      `${formatBytes(system.memoryUsedBytes)} / ${formatBytes(system.memoryTotalBytes)}`
    );
    setMetric('metricAppCpu', app.cpuPercent, `服务 PID ${app.pid}`);
    setMetric(
      'metricAppGpu',
      app.gpuAvailable ? app.gpuPercent : null,
      app.gpuAvailable ? `服务 PID ${app.pid}` : (app.gpuMessage || '不可用')
    );
    setMetric(
      'metricAppMemory',
      app.memoryPercent,
      `占用 ${formatBytes(app.memoryRssBytes)}，堆内存 ${formatBytes(app.memoryHeapUsedBytes)}`
    );
    document.getElementById('metricsSampleWindow').textContent = `采样窗口：${Math.round((metrics.windowMs || 0) / 1000)} 秒`;
    document.getElementById('metricsSampleTime').textContent = `检测时间：${formatDateTime(metrics.sampledAt)}`;
    document.getElementById('metricsProcessPid').textContent = `本次服务进程：${app.pid || '--'}，已运行 ${formatDuration(app.uptimeSeconds)}，直播期间保持开启`;
  }

  function renderMetricsError(error) {
    document.getElementById('metricsStatus').textContent = error.message || '检测失败';
  }

  async function loadHardwareSummary(includeTemperatures) {
    if (hardwareLoading || (hardwareLoaded && !includeTemperatures)) return;
    hardwareLoading = true;
    document.getElementById('hardwareSummaryStatus').textContent = '正在读取本机硬件信息';

    try {
      const response = await fetch(`/api/system/hardware?includeTemperatures=${includeTemperatures}`);
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || '硬件信息读取失败');
      renderHardwareSummary(payload.data, includeTemperatures);
      hardwareLoaded = true;
    } catch (_) {
      document.getElementById('hardwareSummaryStatus').textContent = '硬件信息暂不可用，不影响性能检测';
    } finally {
      hardwareLoading = false;
    }
  }

  function renderHardwareSummary(summary, includesTemperatures) {
    const cpu = summary.cpu || {};
    const memory = summary.memory || {};
    const gpus = Array.isArray(summary.gpus) ? summary.gpus : [];
    const memoryModules = Array.isArray(memory.modules) ? memory.modules : [];

    setHardwareText('hardwareCpuModel', cpu.model || '未知 CPU');
    setHardwareText('hardwareCpuDetail', `物理 ${cpu.physicalCores || '--'} 核 / 逻辑 ${cpu.logicalCores || '--'} 线程`);
    setHardwareText('hardwareCpuTemperature', `温度：${formatTemperature(cpu, '未知')}`);

    setHardwareText('hardwareGpuModel', gpus.length ? gpus.map((gpu) => gpu.name || '未知 GPU').join(' / ') : '未读取到 GPU');
    setHardwareText(
      'hardwareGpuDetail',
      gpus.length
        ? gpus.map((gpu) => `${gpu.vendor || '未知厂商'}，显存 ${formatHardwareBytes(gpu.videoMemoryBytes)}`).join('；')
        : 'Windows 未返回显卡信息'
    );
    setHardwareText(
      'hardwareGpuTemperature',
      `温度：${gpus.length ? gpus.map((gpu) => `${gpu.name || 'GPU'} ${formatTemperature(gpu)}`).join('；') : '不可用'}`
    );

    setHardwareText(
      'hardwareMemoryModel',
      `${formatHardwareBytes(memory.totalBytes)} 内存${memoryModules.length ? `，${memoryModules.length} 条` : ''}`
    );
    setHardwareText(
      'hardwareMemoryDetail',
      memoryModules.length
        ? memoryModules.map((module) => [
          module.manufacturer,
          module.model,
          formatHardwareBytes(module.capacityBytes),
          module.speedMhz ? `${module.speedMhz} MHz` : ''
        ].filter(Boolean).join(' ')).join('；')
        : 'Windows 未返回内存条型号'
    );
    document.getElementById('hardwareSummaryStatus').textContent = includesTemperatures
      ? '型号和容量已缓存；GPU 温度为本次检测时临时读取'
      : '型号和容量已读取；GPU 温度仅在检测时读取';
  }

  function setHardwareText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function formatHardwareBytes(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0 ? formatBytes(Number(value)) : '容量未知';
  }

  function formatTemperature(device, unavailableText) {
    const rawTemperature = device.temperatureCelsius;
    if (rawTemperature === null || rawTemperature === undefined || String(rawTemperature).trim() === '') {
      return unavailableText || device.temperatureMessage || '不可用';
    }
    const temperature = Number(rawTemperature);
    return Number.isFinite(temperature) ? `${temperature.toFixed(0)}°C` : (device.temperatureMessage || '不可用');
  }

  function setMetric(id, percent, detail) {
    const valueNode = document.getElementById(id);
    const barNode = document.getElementById(`${id}Bar`);
    const detailNode = document.getElementById(`${id}Detail`);
    const val = Number(percent);
    const available = Number.isFinite(val);

    valueNode.textContent = available ? `${val.toFixed(1)}%` : '不可用';
    barNode.style.width = available ? `${Math.max(0, Math.min(100, val))}%` : '0%';
    detailNode.textContent = detail || '等待检测';
    valueNode.closest('.metric-card').className = `metric-card ${metricLevel(val)}`;
  }

  function metricLevel(val) {
    if (!Number.isFinite(val)) return 'muted';
    if (val >= 85) return 'danger-level';
    if (val >= 70) return 'warn-level';
    return 'good-level';
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.metrics = {
    initPerformanceMonitor,
    runMetricsSample,
    setMetricsBusy,
    renderMetrics,
    renderMetricsError,
    loadHardwareSummary,
    renderHardwareSummary,
    setMetric,
    metricLevel
  };
})();
