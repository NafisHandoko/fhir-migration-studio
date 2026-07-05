import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  // const [greetMsg, setGreetMsg] = useState("");
  // const [name, setName] = useState("");

  // async function greet() {
  //   // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  //   setGreetMsg(await invoke("greet", { name }));
  // }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
      <h1 className="text-4xl font-bold text-emerald-400 animate-pulse">
        Tauri + Vite + React + Tailwind v4 is working!
      </h1>
      <div className="bg-blue-500 text-white p-4 rounded-lg">
        Tesaja
      </div>
    </div>
  );
}

export default App;
