/* ============================================================
   Scholix — sign-in page behaviour
   Credential validation and sign-in.
   ============================================================ */

import { authenticate, clearSession, currentUser, writeSession } from "./data.js";

const form = document.querySelector("#signinForm");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const rememberInput = document.querySelector("#remember");
const authError = document.querySelector("#authError");
const emailError = document.querySelector("#emailError");
const passwordError = document.querySelector("#passwordError");
const passwordToggle = document.querySelector("#passwordToggle");
function showError(message) {
  authError.hidden = false;
  authError.textContent = message;
}

function clearErrors() {
  authError.hidden = true;
  authError.textContent = "";
  [emailError, passwordError].forEach((el) => {
    el.hidden = true;
    el.textContent = "";
  });
  emailInput.closest(".field").classList.remove("field--error");
  passwordInput.closest(".field").classList.remove("field--error");
}

async function handleSubmit(event) {
  event.preventDefault();
  clearErrors();

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  let valid = true;

  if (!email) {
    emailError.hidden = false;
    emailError.textContent = "Enter your school email.";
    emailInput.closest(".field").classList.add("field--error");
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    emailError.hidden = false;
    emailError.textContent = "That email address looks incomplete.";
    emailInput.closest(".field").classList.add("field--error");
    valid = false;
  }

  if (!password) {
    passwordError.hidden = false;
    passwordError.textContent = "Enter your password.";
    passwordInput.closest(".field").classList.add("field--error");
    valid = false;
  }

  if (!valid) return;

  const button = document.querySelector("#signinBtn");
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const user = await authenticate(email, password, rememberInput.checked);
    if (!user) {
      showError("The email or password is incorrect. Please try again.");
      passwordInput.value = "";
      passwordInput.focus();
      return;
    }

    writeSession(user, rememberInput.checked);
    window.location.href = "./dashboard.php";
  } catch (error) {
    console.error("Scholix sign-in request failed.", error);
    showError("The school server did not respond. Check that Apache and MySQL are running, then try again.");
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
}

function init() {
  // Already signed in? Go straight to the dashboard.
  if (currentUser() && !new URLSearchParams(window.location.search).has("stay")) {
    window.location.replace("./dashboard.php");
    return;
  }
  clearSession();

  passwordToggle.addEventListener("click", () => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    passwordToggle.setAttribute("aria-pressed", String(!showing));
    passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });

  form.addEventListener("submit", handleSubmit);
}

init();


