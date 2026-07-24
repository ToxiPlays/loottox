self.addEventListener('push', e => {
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/common_cover.png'
    }).then(() => {
      if (data.final) {
        return self.registration.unregister();
      }
    })
  );
});