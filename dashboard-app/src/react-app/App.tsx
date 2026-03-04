import { BrowserRouter as Router, Routes, Route } from "react-router";
import { SchemaProvider } from "@/react-app/contexts/SchemaContext";
import Dashboard from "@/react-app/pages/Dashboard";

export default function App() {
  return (
    <SchemaProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Dashboard />} />
        </Routes>
      </Router>
    </SchemaProvider>
  );
}
