// 아침 영어 뉴스 클럽: 알림 전용 서비스 워커.
// 화면 파일을 저장(캐시)하지 않으므로, 앱 업데이트는 지금처럼 바로 반영됩니다.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "아침 영어 뉴스 클럽", {
    body: d.body || "영어 뉴스 들을 시간이에요. 눌러서 열어 보세요.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag || "daily",
    data: { url: d.url || "./#/" }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || "./#/", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && "focus" in c) {
        if ("navigate" in c) c.navigate(url).catch(function () {});
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
