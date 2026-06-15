const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "64kb" }));

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "users.json");
const TMP_FILE = path.join(DATA_DIR, "users.json.tmp");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), "utf8");
}

function now() {
    return Date.now();
}

function readUsersFromDisk() {
    try {
        const raw = fs.readFileSync(DB_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.map(normalizeUser).filter(Boolean);
    } catch {
        return [];
    }
}

function normalizeUser(user) {
    if (!user || typeof user !== "object") {
        return null;
    }

    return {
        id: String(user.id || ""),
        username: String(user.username || "Guest"),
        passwordHash: String(user.passwordHash || ""),
        coins: Number.isFinite(Number(user.coins)) ? Number(user.coins) : 0,
        inventory: Array.isArray(user.inventory) ? user.inventory : [],
        friends: Array.isArray(user.friends) ? user.friends.map(String) : [],
        lastPing: typeof user.lastPing === "number" ? user.lastPing : 0,
        isPlaying: !!user.isPlaying
    };
}

let usersCache = readUsersFromDisk();

let saveTimer = null;
let dirty = false;

function queueSave() {
    dirty = true;

    if (saveTimer) {
        return;
    }

    saveTimer = setTimeout(() => {
        saveTimer = null;
        flushSave();
    }, 250);
}

function flushSave() {
    if (!dirty) {
        return;
    }

    const payload = JSON.stringify(usersCache, null, 2);

    try {
        fs.writeFileSync(TMP_FILE, payload, "utf8");
        fs.renameSync(TMP_FILE, DB_FILE);
        dirty = false;
    } catch (err) {
        console.error(err);
    }
}

setInterval(() => {
    flushSave();
}, 5000);

process.on("SIGINT", () => {
    flushSave();
    process.exit(0);
});

process.on("SIGTERM", () => {
    flushSave();
    process.exit(0);
});

function isOnline(user) {
    return typeof user.lastPing === "number" && (now() - user.lastPing) < 10000;
}

function getPublicUser(user) {
    const normalized = normalizeUser(user);
    if (!normalized) {
        return null;
    }

    return {
        id: normalized.id,
        username: normalized.username,
        coins: normalized.coins,
        inventory: normalized.inventory,
        friends: normalized.friends,
        isPlaying: normalized.isPlaying,
        online: isOnline(normalized)
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
    const target = String(username || "").toLowerCase();
    return users.findIndex(user => String(user.username || "").toLowerCase() === target);
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
    const publicUsers = usersCache.map(getPublicUser).filter(Boolean);
    return res.json({ ok: true, users: publicUsers });
});

app.get("/users/:id", (req, res) => {
    const index = findUserIndexById(usersCache, req.params.id);

    if (index === -1) {
        return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.json({ ok: true, user: getPublicUser(usersCache[index]) });
});

app.get("/username-exists/:username", (req, res) => {
    try {
        const username = String(req.params.username || "").trim();

        if (!username) {
            return res.status(400).json({ error: "Falta username" });
        }

        const exists = findUserIndexByUsername(usersCache, username) !== -1;

        return res.json({
            ok: true,
            exists
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/register", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!username || !password) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        if (username.length < 3) {
            return res.status(400).json({ error: "Username muy corto" });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "Contraseña muy corta" });
        }

        const exists = findUserIndexByUsername(usersCache, username) !== -1;
        if (exists) {
            return res.status(409).json({ error: "Ese nombre ya existe" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const id = generateUniqueId(usersCache);

        const newUser = normalizeUser({
            id,
            username,
            passwordHash,
            coins: 0,
            inventory: [],
            friends: [],
            lastPing: now(),
            isPlaying: false
        });

        usersCache.push(newUser);
        queueSave();

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

        const index = findUserIndexByUsername(usersCache, username);

        if (index === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const user = usersCache[index];
        const ok = await bcrypt.compare(password, user.passwordHash);

        if (!ok) {
            return res.status(401).json({ error: "Contraseña incorrecta" });
        }

        user.lastPing = now();
        queueSave();

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

        const index = findUserIndexById(usersCache, userId);

        if (index === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        usersCache[index].lastPing = 0;
        usersCache[index].isPlaying = false;
        queueSave();

        log("User logged out", `${usersCache[index].username} (${usersCache[index].id})`);

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

        const index = findUserIndexById(usersCache, userId);

        if (index === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        usersCache[index].lastPing = now();
        usersCache[index].isPlaying = isPlaying;

        return res.json({
            ok: true,
            online: true,
            isPlaying: usersCache[index].isPlaying
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.get("/presence/:id", (req, res) => {
    try {
        const index = findUserIndexById(usersCache, req.params.id);

        if (index === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const user = usersCache[index];

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

        const userIndex = findUserIndexById(usersCache, userId);
        const friendIndex = findUserIndexById(usersCache, friendId);

        if (userIndex === -1 || friendIndex === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        if (!usersCache[userIndex].friends.includes(friendId)) {
            usersCache[userIndex].friends.push(friendId);
        }

        if (!usersCache[friendIndex].friends.includes(userId)) {
            usersCache[friendIndex].friends.push(userId);
        }

        queueSave();

        log("Friend added", `${usersCache[userIndex].username} <-> ${usersCache[friendIndex].username}`);

        return res.json({
            ok: true,
            user: getPublicUser(usersCache[userIndex]),
            friend: getPublicUser(usersCache[friendIndex])
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

        const userIndex = findUserIndexById(usersCache, userId);
        const friendIndex = findUserIndexById(usersCache, friendId);

        if (userIndex === -1 || friendIndex === -1) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        usersCache[userIndex].friends = usersCache[userIndex].friends.filter(id => id !== friendId);
        usersCache[friendIndex].friends = usersCache[friendIndex].friends.filter(id => id !== userId);

        queueSave();

        log("Friend removed", `${usersCache[userIndex].username} <-> ${usersCache[friendIndex].username}`);

        return res.json({
            ok: true,
            user: getPublicUser(usersCache[userIndex]),
            friend: getPublicUser(usersCache[friendIndex])
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.get("/online", (req, res) => {
    try {
        const onlineUsers = usersCache.filter(isOnline).map(getPublicUser).filter(Boolean);
        return res.json({ ok: true, users: onlineUsers });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.listen(PORT, () => {
    log("Michiverse server running on " + PORT);
});
