// 编写人：Aurora
// 主题预设数据 + 渲染函数。挂载到 window.AdminApp.theme
'use strict';

(function () {
  const U = window.AdminApp.utils;

  const defaultThemeLook = {
    themePrimary: '#ff6f91', themeAccent: '#21b6a8',
    themeText: '#ffffff', themeBackground: '#181823',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    themeOpacity: '0.35', themeRadius: '12',
    overlayLowPowerMode: 'false', backdropBlur: '0', glowIntensity: '0',
    enableGradient: 'false', gradientEnd: '#181823',
    overlayFontFamily: 'Microsoft YaHei', overlayFontWeight: '800',
    overlaySongColor: '', overlayRequesterColor: '',
    overlayTitle: '', overlayShowIndex: 'true',
    overlayIndexThreshold: '0', overlayIndexColor: '#fbbf24',
    queueFixedSixRows: 'true', queueScrollMode: 'bounce', queueScrollSpeed: '80'
  };

  const classicThemePresets = {
    pure: { themePrimary:'#555555',themeAccent:'#888888',themeText:'#1a1a1a',themeBackground:'#ffffff',themeOpacity:'0.00',themeRadius:'0',backdropBlur:'0',glowIntensity:'0',enableGradient:'false',gradientEnd:'#ffffff',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'PingFang SC, Microsoft YaHei, sans-serif',overlayFontWeight:'600',overlaySongColor:'#1a1a1a',overlayRequesterColor:'#666666',queueScrollSpeed:'80' },
    cream: { themePrimary:'#f59e0b',themeAccent:'#d97706',themeText:'#3d2a14',themeBackground:'#f5ede4',themeOpacity:'0.45',themeRadius:'14',backdropBlur:'24',glowIntensity:'2',enableGradient:'true',gradientEnd:'#e8d5c0',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'KaiTi, STKaiti, serif',overlayFontWeight:'700',overlaySongColor:'#5c3d1a',overlayRequesterColor:'#8b6914',queueScrollSpeed:'80' },
    sky: { themePrimary:'#3b82f6',themeAccent:'#f59e0b',themeText:'#1a2e3d',themeBackground:'#e8f2f8',themeOpacity:'0.42',themeRadius:'12',backdropBlur:'22',glowIntensity:'2',enableGradient:'true',gradientEnd:'#d8e8f4',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'PingFang SC, Microsoft YaHei, sans-serif',overlayFontWeight:'700',overlaySongColor:'#1e40af',overlayRequesterColor:'#64748b',queueScrollSpeed:'80' },
    sakura: { themePrimary:'#ff7eb3',themeAccent:'#7ec8e3',themeText:'#fff5f7',themeBackground:'#1a1424',themeOpacity:'0.28',themeRadius:'16',backdropBlur:'22',glowIntensity:'4',enableGradient:'true',gradientEnd:'#2d1a2e',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'system-ui, -apple-system, sans-serif',overlayFontWeight:'800',overlaySongColor:'#fda4af',overlayRequesterColor:'#c0a4b8',queueScrollSpeed:'80' },
    starry: { themePrimary:'#c4b5fd',themeAccent:'#67e8f9',themeText:'#f5f3ff',themeBackground:'#0f0a1e',themeOpacity:'0.26',themeRadius:'14',backdropBlur:'24',glowIntensity:'6',enableGradient:'true',gradientEnd:'#1e1050',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'PingFang SC, Microsoft YaHei, sans-serif',overlayFontWeight:'700',overlaySongColor:'#ddd6fe',overlayRequesterColor:'#a5b4fc',queueScrollSpeed:'80' },
    ocean: { themePrimary:'#60a5fa',themeAccent:'#fbbf24',themeText:'#f0f9ff',themeBackground:'#0c1929',themeOpacity:'0.30',themeRadius:'12',backdropBlur:'20',glowIntensity:'4',enableGradient:'true',gradientEnd:'#061a34',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'Microsoft YaHei, SimHei, sans-serif',overlayFontWeight:'800',overlaySongColor:'#93c5fd',overlayRequesterColor:'#7b9cc4',queueScrollSpeed:'80' },
    cyber: { themePrimary:'#22d3ee',themeAccent:'#e879f9',themeText:'#f0f9ff',themeBackground:'#0a0a14',themeOpacity:'0.32',themeRadius:'6',backdropBlur:'14',glowIntensity:'14',enableGradient:'true',gradientEnd:'#140a28',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'PingFang SC, Microsoft YaHei, sans-serif',overlayFontWeight:'800',overlaySongColor:'#67e8f9',overlayRequesterColor:'#d8b4fe',queueScrollSpeed:'80' },
    gold: { themePrimary:'#fbbf24',themeAccent:'#f59e0b',themeText:'#fefce8',themeBackground:'#0c0a08',themeOpacity:'0.32',themeRadius:'10',backdropBlur:'22',glowIntensity:'6',enableGradient:'true',gradientEnd:'#1c1608',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'KaiTi, STKaiti, serif',overlayFontWeight:'700',overlaySongColor:'#fde68a',overlayRequesterColor:'#a3a18a',queueScrollSpeed:'80' },
    emerald: { themePrimary:'#34d399',themeAccent:'#fbbf24',themeText:'#f0fdf4',themeBackground:'#0a1a10',themeOpacity:'0.30',themeRadius:'12',backdropBlur:'20',glowIntensity:'5',enableGradient:'true',gradientEnd:'#061208',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'PingFang SC, Microsoft YaHei, sans-serif',overlayFontWeight:'700',overlaySongColor:'#6ee7b7',overlayRequesterColor:'#86a894',queueScrollSpeed:'80' },
    rose: { themePrimary:'#f472b6',themeAccent:'#c084fc',themeText:'#fff1f5',themeBackground:'#1a0e14',themeOpacity:'0.30',themeRadius:'14',backdropBlur:'22',glowIntensity:'5',enableGradient:'true',gradientEnd:'#2d1020',queueSongFontSize:'20',queueTitleFontSize:'15',overlayFontFamily:'system-ui, -apple-system, sans-serif',overlayFontWeight:'800',overlaySongColor:'#f9a8d4',overlayRequesterColor:'#c4a0b0',queueScrollSpeed:'80' }
  };

  const classicPresetLabels = {
    pure:'🪟 纯透极简', cream:'🥛 奶油杏白', sky:'☁️ 晴空浅蓝',
    sakura:'🌸 樱粉甜梦', starry:'✨ 星夜幻紫', ocean:'🌊 深海湛蓝',
    cyber:'⚡ 赛博霓虹', gold:'🥇 暗夜黑金', emerald:'🌲 翡翠深林', rose:'🌹 丝绒玫瑰'
  };

  const classicPresetSwatches = {
    pure:['#ffffff','#555555','#888888','#1a1a1a'], cream:['#f5ede4','#f59e0b','#d97706','#3d2a14'],
    sky:['#e8f2f8','#3b82f6','#f59e0b','#1a2e3d'], sakura:['#1a1424','#ff7eb3','#7ec8e3','#fff5f7'],
    starry:['#0f0a1e','#c4b5fd','#67e8f9','#f5f3ff'], ocean:['#0c1929','#60a5fa','#fbbf24','#f0f9ff'],
    cyber:['#0a0a14','#22d3ee','#e879f9','#f0f9ff'], gold:['#0c0a08','#fbbf24','#f59e0b','#fefce8'],
    emerald:['#0a1a10','#34d399','#fbbf24','#f0fdf4'], rose:['#1a0e14','#f472b6','#c084fc','#fff1f5']
  };

  function renderClassicPresetCards(container) {
    if (!container) return;
    container.innerHTML = Object.entries(classicThemePresets).map(([key, preset]) => {
      const swatches = classicPresetSwatches[key] || ['#181823','#ccc','#ccc','#fff'];
      const label = classicPresetLabels[key] || key;
      return `<div class="preset-card" data-theme="${key}"><div class="swatch-preview"><span style="background:${swatches[0]}"></span><span style="background:${swatches[1]}"></span><span style="background:${swatches[2]}"></span><span style="background:${swatches[3]}"></span></div><strong>${label}</strong></div>`;
    }).join('');
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.theme = {
    defaultThemeLook, classicThemePresets, classicPresetLabels, classicPresetSwatches,
    renderClassicPresetCards
  };
})();
