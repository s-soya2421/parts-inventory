import type { FormEvent } from "react";

export function LogoutButton({ className }: { className: string }) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Explain the browser-owned prompt before navigating away from the app.
    // Re-entering valid credentials on the logout endpoint would repeat it.
    if (!window.confirm("ログアウトします。続いて認証画面が表示された場合は、ID・パスワードを入力せず「キャンセル」を選んでください。")) {
      event.preventDefault();
    }
  }

  return (
    <form method="post" action="/api/logout" onSubmit={handleSubmit}>
      <button type="submit" className={className}>ログアウト</button>
    </form>
  );
}
