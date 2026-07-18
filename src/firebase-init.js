// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAzIvZ_y3goD5JORHU5xX2VFgrI3AKpF6U",
  authDomain: "trade-journal-d7e7a.firebaseapp.com",
  projectId: "trade-journal-d7e7a",
  storageBucket: "trade-journal-d7e7a.firebasestorage.app",
  messagingSenderId: "774698675766",
  appId: "1:774698675766:web:b002f3b298a0052c73f297",
  measurementId: "G-27GEHELT8J"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export { app };
