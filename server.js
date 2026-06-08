const express = require("express");

const app = express();
app.use(express.json());

const users = {};

app.get("/", (req, res) => {
    res.send("Michiverse server online");
});

app.post("/register", (req, res) => {
    const { username, password } = req.body;

    if (users[username]) {
        return res.status(400).json({ error: "User exists" });
    }

    users[username] = { password };

    res.json({ ok: true });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    const user = users[username];

    if (!user) return res.status(404).json({ error: "No user" });
    if (user.password !== password)
        return res.status(401).json({ error: "Wrong password" });

    res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Michiverse running on " + PORT);
});
    if (user.password !== password) {
        return res.status(401).json({ error: "Wrong password" });
    }

    res.json({ ok: true, user: username });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Michiverse running on " + PORT);
});
