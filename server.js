const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

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

function now() {
    return Date.now();
}

function isOnline(user) {
    return typeof user.lastPing === "number" && (now() - user.lastPing) < 10000;
}

function getPublicUser(user) {
    return {
        id: user.id,
        username: user.username,
        coins: user.coins,
        inventory: user.inventory,
        friends: user.friends,
        isPlaying: user.isPlaying,
        online: isOnline(user)
    };
}

function generateUniqueId(users) {
    let id = "";
    let exists = true;

    while (exists) {
        id = String(crypto.randomInt(100000000, 999999999));
        exists = users.some(user => user.id === id);
    }

    return id;
}

function findUserIndexById(users, id) {
    return users.findIndex(user => user.id === String(id));
}

function findUserIndexByUsername(users, username) {
    return users.findIndex(user => user.username.toLowerCase() === String(username).toLowerCase());
}

function log(message, value = "") {
    if (value !== "") {
        console.log(`[Michiverse] ${message}: ${value}`);
    } else {
        console.log(`[Michiverse] ${message}`);
    }
}

app.get("/", (req, res) => {
    res.send("Michiverse server online");
});

app.get("/users", (req, res) => {
    const users = readUsers();
    const publicUsers = users.map(getPublicUser);
    return res.json({ ok: true, users: publicUsers });
});

app.get("/users/:id", (req, res) => {
    const users = readUsers();
    const index = findUserIndexById(users, req.params.id);

    if (index === -1) {
        return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.json({ ok: true, user: getPublicUser(users[index]) });
});

app.post("/register", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!username || !password) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        const users = readUsers();
        const exists = findUserIndexByUsername(users, username) !== -1;

        if (exists) {
            return res.status(409).json({ error: "Ese nombre ya existe" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const id = generateUniqueId(users);

        const newUser = {
            id,
            username,
            passwordHash,
            coins: 0,
            inventory: [],
            friends: [],
            lastPing: now(),
            isPlaying: false
        };

        users.push(newUser);
        saveUsers(users);

        log("User registered", `${username} (${id})`);

        return res.json({
            ok: true,
            user: getPublicUser(newUser)
        });
    } catch (err) {
        console.error(err);
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
        const index = findUserIndexByUsername(users, username);

        if (index === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const user = users[index];
        const ok = await bcrypt.compare(password, user.passwordHash);

        if (!ok) {
            return res.status(401).json({ error: "Contraseña incorrecta" });
        }

        user.lastPing = now();
        saveUsers(users);

        log("User logged", `${user.username} (${user.id})`);

        return res.json({
            ok: true,
            user: getPublicUser(user)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/logout", (req, res) => {
    try {
        const userId = String(req.body.userId || "").trim();

        if (!userId) {
            return res.status(400).json({ error: "Falta userId" });
        }

        const users = readUsers();
        const index = findUserIndexById(users, userId);

        if (index === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        users[index].lastPing = 0;
        users[index].isPlaying = false;
        saveUsers(users);

        log("User logged out", `${users[index].username} (${users[index].id})`);

        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/ping", (req, res) => {
    try {
        const userId = String(req.body.userId || "").trim();
        const isPlaying = !!req.body.isPlaying;

        if (!userId) {
            return res.status(400).json({ error: "Falta userId" });
        }

        const users = readUsers();
        const index = findUserIndexById(users, userId);

        if (index === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        users[index].lastPing = now();
        users[index].isPlaying = isPlaying;
        saveUsers(users);

        return res.json({
            ok: true,
            online: true,
            isPlaying: users[index].isPlaying
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.get("/presence/:id", (req, res) => {
    try {
        const users = readUsers();
        const index = findUserIndexById(users, req.params.id);

        if (index === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const user = users[index];

        return res.json({
            ok: true,
            userId: user.id,
            username: user.username,
            online: isOnline(user),
            isPlaying: user.isPlaying,
            lastPing: user.lastPing
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/friends/add", (req, res) => {
    try {
        const userId = String(req.body.userId || "").trim();
        const friendId = String(req.body.friendId || "").trim();

        if (!userId || !friendId) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        if (userId === friendId) {
            return res.status(400).json({ error: "No te puedes agregar a ti mismo" });
        }

        const users = readUsers();
        const userIndex = findUserIndexById(users, userId);
        const friendIndex = findUserIndexById(users, friendId);

        if (userIndex === -1 || friendIndex === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        if (!users[userIndex].friends.includes(friendId)) {
            users[userIndex].friends.push(friendId);
        }

        if (!users[friendIndex].friends.includes(userId)) {
            users[friendIndex].friends.push(userId);
        }

        saveUsers(users);

        log("Friend added", `${users[userIndex].username} <-> ${users[friendIndex].username}`);

        return res.json({
            ok: true,
            user: getPublicUser(users[userIndex]),
            friend: getPublicUser(users[friendIndex])
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/friends/remove", (req, res) => {
    try {
        const userId = String(req.body.userId || "").trim();
        const friendId = String(req.body.friendId || "").trim();

        if (!userId || !friendId) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        const users = readUsers();
        const userIndex = findUserIndexById(users, userId);
        const friendIndex = findUserIndexById(users, friendId);

        if (userIndex === -1 || friendIndex === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        users[userIndex].friends = users[userIndex].friends.filter(id => id !== friendId);
        users[friendIndex].friends = users[friendIndex].friends.filter(id => id !== userId);

        saveUsers(users);

        log("Friend removed", `${users[userIndex].username} <-> ${users[friendIndex].username}`);

        return res.json({
            ok: true,
            user: getPublicUser(users[userIndex]),
            friend: getPublicUser(users[friendIndex])
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.get("/online", (req, res) => {
    try {
        const users = readUsers();
        const onlineUsers = users.filter(isOnline).map(getPublicUser);
        return res.json({ ok: true, users: onlineUsers });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    log("Michiverse server running on " + PORT);
});
