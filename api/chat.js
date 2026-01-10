/* ============================================
   FIX: Weather Effects ONLY in Weather Card
   ============================================ */

/* Add this CSS to your index.html <style> section */

/* 1. Remove body background changes - keep it consistent */
body.light {
    background: linear-gradient(to bottom right, #fce7f3, #e9d5ff, #c7d2fe) !important;
}

body.dark {
    background: #000 !important;
}

/* 2. Create a container for weather effects INSIDE the weather card */
#weather-card {
    position: relative;
    overflow: hidden; /* Contain effects within card */
}

/* 3. Move weather effects into the weather card */
.weather-effect-local {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 1;
    border-radius: 1rem; /* Match card border radius */
}

/* 4. Ensure weather text is above effects */
#weather-card > * {
    position: relative;
    z-index: 2;
}

/* ============================================
   JavaScript Changes Needed
   ============================================ */

// In your index.html, find the createWeatherEffect function and replace it:

function createWeatherEffect(weatherCode, temperature) {
    // CHANGE 1: Get weather card instead of body
    const container = document.getElementById('weather-card');
    
    // CHANGE 2: Create local effects container if it doesn't exist
    let effectsDiv = container.querySelector('.weather-effect-local');
    if (!effectsDiv) {
        effectsDiv = document.createElement('div');
        effectsDiv.className = 'weather-effect-local';
        container.insertBefore(effectsDiv, container.firstChild);
    }
    
    effectsDiv.innerHTML = ''; // Clear existing effects
    
    // CHANGE 3: Don't change body background - only card background
    // Remove all body.style.background changes
    
    // Snow (codes 71-77)
    if (weatherCode >= 71 && weatherCode <= 77) {
        for (let i = 0; i < 20; i++) { // Reduced from 50 to 20
            const snowflake = document.createElement('div');
            snowflake.className = 'snowflake';
            snowflake.textContent = '❄';
            snowflake.style.left = Math.random() * 100 + '%';
            snowflake.style.animationDuration = (Math.random() * 3 + 2) + 's';
            snowflake.style.animationDelay = Math.random() * 5 + 's';
            snowflake.style.fontSize = (Math.random() * 10 + 10) + 'px';
            effectsDiv.appendChild(snowflake);
        }
        // Change card background instead of body
        container.style.background = 'linear-gradient(to bottom, #B8C6DB, #F5F7FA)';
    }
    // Rain (codes 51-67, 80-82)
    else if ((weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82)) {
        for (let i = 0; i < 30; i++) { // Reduced from 100 to 30
            const raindrop = document.createElement('div');
            raindrop.className = 'raindrop';
            raindrop.style.left = Math.random() * 100 + '%';
            raindrop.style.animationDuration = (Math.random() * 0.5 + 0.5) + 's';
            raindrop.style.animationDelay = Math.random() * 2 + 's';
            effectsDiv.appendChild(raindrop);
        }
        container.style.background = 'linear-gradient(to bottom, #4A5568, #718096)';
        container.style.color = 'white'; // Make text readable
    }
    // Thunderstorm (codes 95-99)
    else if (weatherCode >= 95 && weatherCode <= 99) {
        for (let i = 0; i < 25; i++) { // Reduced from 80
            const raindrop = document.createElement('div');
            raindrop.className = 'raindrop';
            raindrop.style.left = Math.random() * 100 + '%';
            raindrop.style.animationDuration = (Math.random() * 0.3 + 0.3) + 's';
            raindrop.style.animationDelay = Math.random() * 1 + 's';
            effectsDiv.appendChild(raindrop);
        }
        container.style.background = 'linear-gradient(to bottom, #2D3748, #4A5568)';
        container.style.color = 'white';
    }
    // Clear/Sunny (code 0-3)
    else if (weatherCode >= 0 && weatherCode <= 3) {
        const sun = document.createElement('div');
        sun.className = 'sun';
        sun.style.position = 'absolute';
        sun.style.top = '20px';
        sun.style.right = '30px';
        sun.style.width = '60px';
        sun.style.height = '60px';
        effectsDiv.appendChild(sun);
        
        // Hot day effect
        if (temperature > 30) {
            container.style.background = 'linear-gradient(to bottom, #FDB750, #FFDAA5)';
        } else {
            container.style.background = 'linear-gradient(to bottom right, #87CEEB, #E0F6FF, #FFF8DC)';
        }
    }
    // Overcast/Cloudy
    else {
        container.style.background = 'linear-gradient(to bottom, #A0AEC0, #CBD5E0)';
    }
}

/* ============================================
   Summary of Changes:
   1. Weather effects now ONLY appear in weather card
   2. Body background stays consistent (light/dark mode)
   3. Reduced particle count for better performance
   4. Text color adjusts for readability
   ============================================ */
