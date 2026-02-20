import { ArrowLeft } from "@untitledui/icons";
import { useNavigate } from "react-router";

export function EditorPage() {
  const navigate = useNavigate();

  const handleBack = () => {
    navigate(-1);
  };

  return (
    <div className="flex h-full flex-col bg-primary">
      <header className="flex items-center gap-3 border-b border-secondary px-4 py-3">
        <button
          onClick={handleBack}
          className="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-secondary"
        >
          <ArrowLeft className="size-4 text-fg-quaternary" />
        </button>
        <h1 className="text-lg font-semibold text-primary">Live2VOD</h1>
      </header>

      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-tertiary">Under construction</p>
      </main>
    </div>
  );
}
