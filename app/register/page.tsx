"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogoMark } from "@/components/Sidebar";

export default function RegisterPage() {
  const [form,    setForm]    = useState({ name: "", email: "", password: "" });
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Registration failed");
      setLoading(false);
      return;
    }

    await signIn("credentials", {
      email: form.email,
      password: form.password,
      redirect: false,
    });

    router.push("/dashboard/settings");
  };

  const fields = [
    { id: "name",     label: "Full Name", type: "text",     placeholder: "Jane Doe",          autoComplete: "name"         },
    { id: "email",    label: "Email",     type: "email",    placeholder: "you@example.com",    autoComplete: "email"        },
    { id: "password", label: "Password",  type: "password", placeholder: "Min. 8 characters",  autoComplete: "new-password" },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-80 bg-indigo-600 flex-col justify-between p-10">
        <div className="flex items-center gap-2.5">
          <LogoMark size={32} />
          <span className="font-bold text-white text-[15px]">LinkedEngage</span>
        </div>
        <div className="space-y-5">
          <p className="text-2xl font-bold text-white leading-snug">
            Start engaging smarter on LinkedIn — in minutes.
          </p>
          <ul className="space-y-2 text-sm text-indigo-200">
            <li className="flex items-center gap-2"><span className="text-indigo-400">✓</span> AI-drafted comments & connection notes</li>
            <li className="flex items-center gap-2"><span className="text-indigo-400">✓</span> One-click send from your dashboard</li>
            <li className="flex items-center gap-2"><span className="text-indigo-400">✓</span> Works with your real LinkedIn session</li>
          </ul>
        </div>
        <p className="text-xs text-indigo-400">
          Free to get started. No credit card required.
        </p>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-7">
          <div className="flex items-center gap-2.5 lg:hidden">
            <LogoMark size={28} />
            <span className="font-bold text-gray-900 text-sm">LinkedEngage</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
            <p className="text-sm text-gray-400 mt-1">Free to start — takes 60 seconds.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {fields.map(({ id, label, type, placeholder, autoComplete }) => (
              <div key={id} className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700" htmlFor={id}>
                  {label}
                </label>
                <input
                  id={id}
                  type={type}
                  autoComplete={autoComplete}
                  value={form[id]}
                  onChange={set(id)}
                  required
                  placeholder={placeholder}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
                />
              </div>
            ))}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="text-sm text-gray-400 text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-indigo-600 font-semibold hover:underline">
              Sign in
            </Link>
          </p>

          <p className="text-center text-xs text-gray-400 leading-relaxed">
            By signing up you agree to use this tool only for your own LinkedIn account
            and in compliance with LinkedIn&apos;s Terms of Service.
          </p>
        </div>
      </div>
    </div>
  );
}
