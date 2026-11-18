export default defineBackground(() => {

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      browser.tabs.create({
        url: browser.runtime.getURL("/install.html"),
      });
    }
  });
  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg.target === 'recorder') return;

    if (msg.type === 'stop') {
      console.log('[recording] forwarding stop request to recorder tab');
      await browser.runtime.sendMessage({ target: 'recorder', type: 'stop' });
      return { ok: true };
    }

    if (msg.type === 'recording-started') {
      await browser.storage.session.set({ recording: true });
      console.log('[recording] session state set to recording');
    }

    if (msg.type === 'stopped') {
      await browser.storage.session.set({ recording: false });
      console.log('[recording] session state cleared');
    }
  });
  console.log('ExamCorder extension is running', browser.runtime.id);
});
