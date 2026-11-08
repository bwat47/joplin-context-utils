// @ts-check
// Runs inside the Resource Properties dialog webview. Joplin applies the dialog HTML
// before loading this script on each open, so the form is already present.
(function () {
    // Joplin collects form values itself; letting the native submit through would reload the webview.
    document.addEventListener('submit', (event) => event.preventDefault());

    // With Joplin's plugin webview isolation enabled, key events only reach this page while focus is
    // inside it, and Joplin doesn't move focus here itself.
    const nameInput = document.querySelector('input[name="name"]');
    if (nameInput instanceof HTMLInputElement) nameInput.focus();
})();
