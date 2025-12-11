document.addEventListener('DOMContentLoaded', () => {
    
    // --- CONFIGURATION ---
    // If running locally, use "http://localhost:3000"
    // If hosted separately (e.g., Render), put that URL here.
    const API_URL = "http://localhost:3000"; 

    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    const verifyBtn = document.getElementById('verifyBtn');
    const statusMessage = document.getElementById('statusMessage');
    const verificationForm = document.getElementById('verificationForm');

    // --- Tab Switching Logic ---
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            const targetId = item.getAttribute('href');
            tabContents.forEach(tab => {
                if (`#${tab.id}` === targetId) {
                    tab.classList.add('active-tab');
                } else {
                    tab.classList.remove('active-tab');
                }
            });
        });
    });

    // --- Verification Logic ---
    if (verificationForm) {
        verificationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const usernameInput = document.getElementById('username');
            const userIdInput = document.getElementById('user_id');
            const username = usernameInput.value;
            const user_id = userIdInput.value;
            
            // UI: Set Loading State
            verifyBtn.disabled = true;
            verifyBtn.classList.add('loading');
            statusMessage.textContent = 'Contacting Server...';
            statusMessage.style.opacity = 1;
            statusMessage.style.backgroundColor = '#555';

            try {
                // Send data to Python Server
                const response = await fetch(`${API_URL}/api/verify`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        username: username, 
                        user_id: user_id 
                    })
                });

                const result = await response.json();

                if (result.status === 'SUCCESS') {
                    statusMessage.textContent = result.message;
                    statusMessage.style.backgroundColor = '#00CC99'; // Green
                } else {
                    statusMessage.textContent = `❌ ${result.message}`;
                    statusMessage.style.backgroundColor = '#FF4444'; // Red
                }

            } catch (error) {
                statusMessage.textContent = '❌ Server Offline or Connection Failed.';
                statusMessage.style.backgroundColor = '#FF4444';
                console.error('Fetch error:', error);
            } finally {
                // UI: Reset State
                verifyBtn.disabled = false;
                verifyBtn.classList.remove('loading');
            }
        });
    }
});