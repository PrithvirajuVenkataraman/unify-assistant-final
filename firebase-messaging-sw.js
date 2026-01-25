// Firebase Messaging Service Worker
// This file MUST be at the root of your domain (e.g., /firebase-messaging-sw.js)

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
firebase.initializeApp({
  apiKey: "AIzaSyBVpkEMOSZXVkKVrlEAksL1R1Rv0tJmdxQ",
  authDomain: "jarvis-assistant-f1abb.firebaseapp.com",
  projectId: "jarvis-assistant-f1abb",
  storageBucket: "jarvis-assistant-f1abb.firebasestorage.app",
  messagingSenderId: "673211850778",
  appId: "1:673211850778:web:5787ef037b14d5addc31a3"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[Service Worker] Received background message:', payload);

  const notificationTitle = payload.notification?.title || 'JARVIS Reminder';
  const notificationOptions = {
    body: payload.notification?.body || 'You have a reminder!',
    icon: '/jarvis-icon.png',
    badge: '/jarvis-badge.png',
    tag: 'jarvis-reminder',
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: payload.data,
    actions: [
      { action: 'snooze', title: '⏰ Snooze 5min' },
      { action: 'dismiss', title: '✓ Dismiss' }
    ]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked:', event.action);

  event.notification.close();

  if (event.action === 'snooze') {
    // Send message to snooze the reminder
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        clientList.forEach((client) => {
          client.postMessage({
            type: 'SNOOZE_REMINDER',
            reminderId: event.notification.data?.reminderId
          });
        });
      })
    );
  } else {
    // Open or focus the app
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        // If app is already open, focus it
        for (const client of clientList) {
          if (client.url.includes('jarvis') && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open new window
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});

// Handle service worker installation
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing JARVIS notification service...');
  self.skipWaiting();
});

// Handle service worker activation
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] JARVIS notification service activated');
  event.waitUntil(clients.claim());
});
