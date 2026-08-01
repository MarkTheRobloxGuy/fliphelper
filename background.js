chrome.commands.onCommand.addListener((command) => {
  console.log('[FlipHelper Background] onCommand triggered:', command);
  if (command === "toggle-ui") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log('[FlipHelper Background] active tabs queried:', tabs);
      if (tabs[0]) {
        console.log('[FlipHelper Background] sending toggle-ui message to tab:', tabs[0].id);
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggle-ui" });
      }
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  console.log('[FlipHelper Background] action clicked, sending toggle-ui message to tab:', tab.id);
  chrome.tabs.sendMessage(tab.id, { action: "toggle-ui" });
});

