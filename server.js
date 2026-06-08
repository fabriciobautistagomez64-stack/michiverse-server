const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "users.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

function readUsers() {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(raw);
}

function saveUsers(users) {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

app.get("/", (req, res) => {
    res.send("Michiverse server online");
});

app.post("/register", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!username || !password) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        const users = readUsers();
        const exists = users.find(
            u => u.username.toLowerCase() === username.toLowerCase()
        );

        if (exists) {
            return res.status(409).json({ error: "Ese nombre ya existe" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const newUser = {
            id: Date.now().toString(),
            username,
            passwordHash,
            coins: 0,
            inventory: []
        };

        users.push(newUser);
        saveUsers(users);

        return res.json({
            ok: true,
            user: {
                id: newUser.id,
                username: newUser.username,
                coins: newUser.coins,
                inventory: newUser.inventory
            }
        });
    } catch (err) {
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/login", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!username || !password) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        const users = readUsers();
        const user = users.find(
            u => u.username.toLowerCase() === username.toLowerCase()
        );

        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const ok = await bcrypt.compare(password, user.passwordHash);

        if (!ok) {
            return res.status(401).json({ error: "Contraseña incorrecta" });
        }

        return res.json({
            ok: true,
            user: {
                id: user.id,
                username: user.username,
                coins: user.coins,
                inventory: user.inventory
            }
        });
    } catch (err) {
        return res.status(500).json({ error: "Error del servidor" });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Michiverse server running on " + PORT);
});
