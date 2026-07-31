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

  let metricsRunning = false;

  function initPerformanceMonitor() {
    const toggle = document.getElementById('metricsToggle');
    const button = document.getElementById('metricsRefreshBtn');
    if (!toggle || !button) return;

    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        runMetricsSample();
      }
    });
    button.addEventListener('click', runMetricsSample);
  }

  async function runMetricsSample() {
    if (metricsRunning) return;
    metricsRunning = true;
    setMetricsBusy(true);

    try {
      const response = await fetch('/api/system/metrics?windowMs=5000');
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || '性能检测失败');
      renderMetrics(payload.data);
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
    const toggle = document.getElementById('metricsToggle');
    const toggleText = document.getElementById('metricsToggleText');
    const button = document.getElementById('metricsRefreshBtn');
    const status = document.getElementById('metricsStatus');

    toggle.checked = isBusy;
    toggle.disabled = isBusy;
    button.disabled = isBusy;
    toggleText.textContent = isBusy ? '检测中' : '开始检测';
    button.textContent = isBusy ? '正在检测' : '检测 5 秒';
    if (isBusy) {
      status.textContent = '正在采样最近 5 秒';
    }
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
    setMetric,
    metricLevel
  };
})();
