document.addEventListener('DOMContentLoaded', () => {
  const betslipActiveText = document.getElementById('betslipActiveText');
  const btnOpenDashboard = document.getElementById('btnOpenDashboard');
  const btnOpenOptions = document.getElementById('btnOpenOptions');

  let livePort = null;

  function connectPort() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connect) {
        livePort = chrome.runtime.connect({ name: 'popup_live_stream' });
        livePort.onMessage.addListener((msg) => {
          if (!msg) return;
          if (msg.type === 'SYNC_DASHBOARD' && msg.payload && msg.payload.betslip) {
            betslipActiveText.textContent = msg.payload.betslip;
            betslipActiveText.style.color = '#00ffcc';
          }
        });
        livePort.onDisconnect.addListener(() => {
          livePort = null;
          setTimeout(connectPort, 1000);
        });
      }
    } catch(e) {}
  }

  connectPort();

  btnOpenDashboard.addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('dashboard-app/dist/index.html'),
      type: 'popup',
      width: 620,
      height: 850
    });
  });

  btnOpenOptions.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });
});
