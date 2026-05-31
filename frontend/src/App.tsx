import { Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import WatchPage from "./pages/WatchPage";
import Layout from "./components/Layout";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/watch/:id" element={<WatchPage />} />
      </Routes>
    </Layout>
  );
}
