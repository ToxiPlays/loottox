self.addEventListener('push', e => {
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/common_cover.png'
    }).then(() => {
      if (data.final) {
        return new Promise(resolve => setTimeout(resolve, 3000))
          .then(() => self.registration.unregister());
      }
    })
  );
});