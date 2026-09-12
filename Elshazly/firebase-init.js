// إعدادات مشروع Firebase الخاص بالعيادة
const firebaseConfig = {
  apiKey: "AIzaSyAga-zTWpvciUjywj_DRiQgx57pVnnSasc",
  authDomain: "al-shazly-clinic.firebaseapp.com",
  projectId: "al-shazly-clinic",
  storageBucket: "al-shazly-clinic.firebasestorage.app",
  messagingSenderId: "580845205384",
  appId: "1:580845205384:web:1e439226863f755d6fac3d",
  measurementId: "G-51FBZG9N8K"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// خلي المستخدم فاضل مسجل دخول حتى لو قفل المتصفح وفتحه تاني
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);