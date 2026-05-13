"use client";

import { useState, useEffect } from "react";

interface AIProfile {
  writingStyle:           string;
  toneDescription:        string;
  exampleComment:         string;
  language:               string;
  negativeKeywords:       string;
  additionalInstructions: string;
}

const EMPTY: AIProfile = {
  writingStyle:           "",
  toneDescription:        "",
  exampleComment:         "",
  language:               "",
  negativeKeywords:       "",
  additionalInstructions: "",
};

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({
  title, description, children,
}: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5 space-y-4">
      <div className="border-b border-gray-100 pb-3">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────
function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-gray-700">{label}</label>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800 " +
  "placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow";

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TrainPage() {
  const [form,    setForm]    = useState<AIProfile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState<{ text: string; ok: boolean } | null>(null);

  // Load existing profile
  useEffect(() => {
    fetch("/api/ai-profile")
      .then((r) => r.json())
      .then(({ profile }) => {
        if (profile) {
          setForm({
            writingStyle:           profile.writingStyle           ?? "",
            toneDescription:        profile.toneDescription        ?? "",
            exampleComment:         profile.exampleComment         ?? "",
            language:               profile.language               ?? "",
            negativeKeywords:       profile.negativeKeywords       ?? "",
            additionalInstructions: profile.additionalInstructions ?? "",
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof AIProfile) => (
    e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res  = await fetch("/api/ai-profile", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    setMsg(res.ok
      ? { text: "Profile saved — new drafts will use your voice.", ok: true }
      : { text: data.error ?? "Save failed.", ok: false }
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="max-w-2xl mx-auto px-6 py-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Train Your AI</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Tell the AI how you write so every comment sounds like you — not a bot.
          </p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="shrink-0 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Save feedback */}
      {msg && (
        <p className={`text-sm rounded-xl px-4 py-2.5 border ${
          msg.ok ? "bg-green-50 text-green-700 border-green-200"
                 : "bg-red-50 text-red-600 border-red-200"
        }`}>
          {msg.text}
        </p>
      )}

      {/* ── Section 1: Voice & Tone ── */}
      <Section
        title="Voice & Tone"
        description="Describe how you naturally write. The AI will match your style on every comment."
      >
        <Field
          label="Writing style"
          hint="How do you write? Short sentences? Casual? Data-driven?"
        >
          <textarea
            value={form.writingStyle}
            onChange={set("writingStyle")}
            rows={2}
            placeholder="e.g. Casual and conversational, short punchy sentences, no fluff"
            className={inputCls + " resize-none"}
          />
        </Field>

        <Field
          label="Tone"
          hint="How should it sound emotionally?"
        >
          <textarea
            value={form.toneDescription}
            onChange={set("toneDescription")}
            rows={2}
            placeholder="e.g. Confident but humble, direct, no corporate speak"
            className={inputCls + " resize-none"}
          />
        </Field>

        <Field
          label="Example comment you've written"
          hint="Paste a real comment you've posted on LinkedIn. This is the strongest signal the AI can use."
        >
          <textarea
            value={form.exampleComment}
            onChange={set("exampleComment")}
            rows={4}
            placeholder="e.g. This nails it. Most people optimise for the metric, not the outcome. Curious — how did your team decide to measure this?"
            className={inputCls + " resize-none"}
          />
        </Field>
      </Section>

      {/* ── Section 2: Language ── */}
      <Section
        title="Language"
        description="What language should the AI write in?"
      >
        <Field label="Preferred language">
          <div className="grid grid-cols-2 gap-3">
            {/* Quick-pick buttons */}
            <div className="flex flex-wrap gap-2 col-span-2">
              {["English", "Spanish", "French", "German", "Portuguese", "Hindi", "Hinglish"].map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, language: lang }))}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                    form.language === lang
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
            <input
              value={form.language}
              onChange={set("language")}
              placeholder="Or type your own…"
              className={inputCls + " col-span-2"}
            />
          </div>
        </Field>
      </Section>

      {/* ── Section 3: Negative keywords ── */}
      <Section
        title="Words to Avoid"
        description="The AI will never use these words or phrases. Separate each with a comma."
      >
        <Field
          label="Negative keywords"
          hint="Great post · Insightful · Absolutely · Congrats · Amazing · ..."
        >
          <textarea
            value={form.negativeKeywords}
            onChange={set("negativeKeywords")}
            rows={3}
            placeholder="e.g. great post, insightful, absolutely, congrats, love this, amazing, game-changer"
            className={inputCls + " resize-none"}
          />
        </Field>

        {/* Live preview chips */}
        {form.negativeKeywords.trim() && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {form.negativeKeywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean)
              .map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs text-red-600 font-medium"
                >
                  <span className="text-red-400">✕</span> {k}
                </span>
              ))}
          </div>
        )}
      </Section>

      {/* ── Section 4: Extra instructions ── */}
      <Section
        title="Additional Instructions"
        description="Anything else? Topics you want to reference, things to always mention, formatting preferences."
      >
        <Field label="Free-form instructions">
          <textarea
            value={form.additionalInstructions}
            onChange={set("additionalInstructions")}
            rows={4}
            placeholder={`e.g. I'm a SaaS founder focused on B2B growth. Always tie comments back to the business angle. Never ask more than one question. End with a specific observation, not a question.`}
            className={inputCls + " resize-none"}
          />
        </Field>
      </Section>

      {/* Bottom save */}
      <div className="flex justify-end pb-6">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-6 py-2.5 transition-colors"
        >
          {saving ? "Saving…" : "Save Profile"}
        </button>
      </div>
    </form>
  );
}
