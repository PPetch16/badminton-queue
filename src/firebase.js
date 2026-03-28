// Import the functions you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; // 🔥 เพิ่มตรงนี้
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDwyDOHMxWYR4XhILmyx5cXJjOcxjGgC54",
  authDomain: "badmintion-random.firebaseapp.com",
  projectId: "badmintion-random",
  storageBucket: "badmintion-random.firebasestorage.app",
  messagingSenderId: "342382415292",
  appId: "1:342382415292:web:c476b4c75626d651616fb9",
  measurementId: "G-PPYEKNMK3Q"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ❗ analytics ใช้ได้เฉพาะ production (ไม่งั้นบางทีพัง)
const analytics = getAnalytics(app);

// 🔥 ตัวจริงที่เราต้องใช้
export const db = getFirestore(app);