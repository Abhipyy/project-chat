// DOM Elements
const loginForm = document.getElementById('loginForm');
const loginFormElement = document.getElementById('loginFormElement');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

const signupForm = document.getElementById('signupForm');
const signupFormElement = document.getElementById('signupFormElement');
const signupUsername = document.getElementById('signupUsername');
const signupPassword = document.getElementById('signupPassword');
const confirmPassword = document.getElementById('confirmPassword');
const signupBtn = document.getElementById('signupBtn');
const signupError = document.getElementById('signupError');
const signupSuccess = document.getElementById('signupSuccess');

const showSignup = document.getElementById('showSignup');
const showLogin = document.getElementById('showLogin');

// Setup event listeners when the page loads
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

// Setup event listeners for form switching and submissions
function setupEventListeners() {
    loginFormElement.addEventListener('submit', handleLogin);
    signupFormElement.addEventListener('submit', handleSignup);
    
    showSignup.addEventListener('click', () => {
        loginForm.classList.add('hidden');
        signupForm.classList.remove('hidden');
        clearMessages();
    });
    
    showLogin.addEventListener('click', () => {
        signupForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        clearMessages();
    });
}

/**
 * Handles the login form submission.
 * Sends user credentials to the server for verification.
 */
async function handleLogin(e) {
    e.preventDefault();
    clearMessages();
    
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    
    if (!username || !password) {
        showLoginError('Please fill in all fields');
        return;
    }
    
    setLoadingState(loginBtn, true);
    
    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();

        if (response.ok) {
            // --- CHANGE 1 & 2: Clear old user data from IndexedDB on successful login ---
            // This ensures a fresh start and prevents seeing another user's cached messages.
            if (window.chatStorage && typeof window.chatStorage.clearAllData === 'function') {
                await window.chatStorage.clearAllData();
            }

            localStorage.setItem('currentUser', JSON.stringify(data.user));
            window.location.href = 'pages/chat.html';
        } else {
            showLoginError(data.message || 'Invalid username or password');
        }

    } catch (error) {
        console.error('Login request failed:', error);
        showLoginError('Could not connect to the server. Please try again.');
    } finally {
        setLoadingState(loginBtn, false);
    }
}

/**
 * Handles the signup form submission.
 * Sends new user details to the server for registration.
 */
async function handleSignup(e) {
    e.preventDefault();
    clearMessages();
    
    const username = signupUsername.value.trim();
    const password = signupPassword.value;
    const confirm = confirmPassword.value;
    
    if (!username || !password || !confirm) {
        showSignupError('Please fill in all fields');
        return;
    }
    if (password !== confirm) {
        showSignupError('Passwords do not match');
        return;
    }
    if (password.length < 6) {
        showSignupError('Password must be at least 6 characters');
        return;
    }
    
    setLoadingState(signupBtn, true);

    try {
        const response = await fetch('/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();

        if (response.ok) {
            showSignupSuccess(data.message || 'Account created! Please log in.');
            signupFormElement.reset();
            setTimeout(() => {
                showLogin.click();
                loginUsername.value = username;
                loginPassword.focus();
            }, 2000);
        } else {
            showSignupError(data.message || 'Registration failed.');
        }

    } catch (error) {
        console.error('Signup request failed:', error);
        showSignupError('Could not connect to the server. Please try again.');
    } finally {
        setLoadingState(signupBtn, false);
    }
}

// --- Helper functions (no changes needed here) ---

function showLoginError(message) {
    loginError.textContent = message;
}

function showSignupError(message) {
    signupError.textContent = message;
    signupSuccess.textContent = '';
}

function showSignupSuccess(message) {
    signupSuccess.textContent = message;
    signupError.textContent = '';
}

function clearMessages() {
    loginError.textContent = '';
    signupError.textContent = '';
    signupSuccess.textContent = '';
}

function setLoadingState(button, isLoading) {
    const originalText = button.id === 'loginBtn' ? 'Login to Secure Chat' : 'Create Account';
    if (isLoading) {
        button.disabled = true;
        button.innerHTML = '<div class="spinner"></div> Processing...';
    } else {
        button.disabled = false;
        button.innerHTML = `<span>${originalText}</span>`;
    }
}