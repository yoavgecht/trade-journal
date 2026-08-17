import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAzIvZ_y3goD5JORHU5xX2VFgrI3AKpF6U',
  authDomain: 'trade-journal-d7e7a.firebaseapp.com',
  projectId: 'trade-journal-d7e7a',
  storageBucket: 'trade-journal-d7e7a.firebasestorage.app',
  messagingSenderId: '774698675766',
  appId: '1:774698675766:web:b002f3b298a0052c73f297',
  measurementId: 'G-27GEHELT8J',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
