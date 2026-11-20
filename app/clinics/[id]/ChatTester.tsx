"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const PROMPTS = ["What are your prices?", "Book", "1", "1", "Cancel"];

export default function ChatTester({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState("+971500001234");
  const [text, setText] = useState("Hello");
  const [replies, setReplies] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId, phone, text: message }),
      });
      const data = (await response.json()) as { replies?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Request failed");
      setReplies(data.replies ?? []);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <input
          className="grow"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          aria-label="Patient phone"
        />
        <input
          className="grow"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Message"
          placeholder="Message as the patient"
        />
        <button type="submit" disabled={busy}>
          {busy ? "Sending" : "Send"}
        </button>
      </form>

      <div className="chips">
        {PROMPTS.map((prompt) => (
          <button key={prompt} type="button" className="ghost" onClick={() => void send(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {replies.length > 0 ? (
        <div className="replies">
          {replies.map((reply, index) => (
            <div key={index} className="bubble out">
              {reply}
            </div>
          ))}
        </div>
      ) : null}

      <p className="note">
        Tip: send BOOK, then reply 1 to choose a service, then 1 to pick a slot.
      </p>
    </div>
  );
}
