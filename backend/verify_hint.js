const http = require('http');

async function request(endpoint, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 4000,
            path: `/api${endpoint}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function testHint() {
    console.log("Testing Hint...");

    // Scenario: Player at (1,1), Box at (2,1), Goal at (3,1)
    // # # # # #
    // # @ $ . #
    // # # # # #
    // Hint should be: Push Box (index 0) Right
    const level = {
        grid: [
            "#####",
            "#   #",
            "#####"
        ],
        // NOTE: The backend generates ASP facts from the GRID CHARACTERS.
        // If we want a goal at (3,1), the grid char MUST be '.'
        // Fixing the grid below:
        grid: [
            "#####",
            "#@$.#",
            "#####"
        ],
        player: { x: 1, y: 1 },
        boxes: [{ x: 2, y: 1 }],
        goals: [{ x: 3, y: 1 }]
    };

    try {
        const res = await request('/get-hint', level);
        console.log("Response:", JSON.stringify(res, null, 2));

        if (res.message && res.message.includes("Push Box 1")) {
            console.log("✅ Custom Hint Test Passed!");
        } else {
            console.log("❌ Custom Hint Test Failed!");
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

testHint();
