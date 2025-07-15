let express = require("express");
let cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const { Pool } = require("pg");
const { DATABASE_URL } = process.env;
const { SECRET_KEY } = process.env;

console.log(DATABASE_URL);

let app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

async function getPostgresVersion() {
    const client = await pool.connect();
    try {
        const response = await client.query("SELECT version()");
        console.log(response.rows[0]);
    } finally {
        client.release();
    }
}

getPostgresVersion();

//force api update
//Test
app.post("/signup/users", async (req, res) => {
    const client = await pool.connect();

    try {
        const { email, username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 12);
        const userResult = await client.query(
            "SELECT * FROM users WHERE email = $1 OR username = $2 ",
            [email, username],
        );
        console.log(userResult);
        if (userResult.rows.length > 0) {
            return res
                .status(400)
                .json({ message: "Username or email is already taken." });
        }
        await client.query(
            "INSERT INTO users (email,username, password) VALUES ($1,$2,$3)",
            [email, username, hashedPassword],
        );
        console.log("New user registered.");
        res.status(201).json({ message: "User registered successfully" });
    } catch (err) {
        console.error("Error", err.message);
        res.status(500).send({ error: err.message });
    } finally {
        client.release();
    }
});

app.post("/signup/coaches", async (req, res) => {
    const client = await pool.connect();

    try {
        const { email, coachname, password } = req.body;
        const coachResult = await client.query(
            "SELECT * FROM coaches WHERE coachname = $1 or email = $2",
            [coachname, email],
        );
        const hashedPassword = await bcrypt.hash(password, 12);
        if (coachResult.rows.length > 0) {
            return res
                .status(400)
                .json({ message: "Username or email is already taken." });
        }
        await client.query(
            `INSERT INTO coaches (email,"coachname", password) VALUES ($1,$2,$3)`,
            [email, coachname, hashedPassword],
        );
        console.log("New user registered.");
        res.status(201).json({ message: "User registered successfully" });
    } catch (err) {
        console.error("Error", err.message);
        res.status(500).send({ error: err.message });
    } finally {
        client.release();
    }
});

app.post("/login/users", async (req, res) => {
    const client = await pool.connect();
    try {
        const userInfo = await client.query(
            "SELECT * FROM users WHERE username = $1 or email = $1 ",
            [req.body.usernameOrEmail],
        );
        console.log("userResult", userInfo);
        const userData = userInfo.rows[0];
        console.log("userName", userData);

        if (!userData)
            return res
                .status(400)
                .json({ message: "Username or email is incorrect" });

        const passwordIsValid = await bcrypt.compare(
            req.body.password,
            userData.password,
        );
        if (!passwordIsValid) {
            return res.status(401).json({ auth: false, token: null });
        }
        var token = jwt.sign(
            { id: userData.id, username: userData.username },
            SECRET_KEY,
            {
                expiresIn: 86400,
            },
        );
        console.log("Logged in user with ID", userData.id);
        res.status(200).json({ auth: true, token: token });
    } catch (err) {
        console.error("Error", err.message);
        res.status(500).send({ error: err.message });
    } finally {
        client.release();
    }
});

app.post("/login/coaches", async (req, res) => {
    const client = await pool.connect();
    try {
        const coachInfo = await client.query(
            "SELECT * FROM coaches WHERE coachname = $1 or email = $1",
            [req.body.usernameOrEmail],
        );
        console.log("coachResult", coachInfo);
        const coachData = coachInfo.rows[0];
        console.log("coachData", coachData);

        if (!coachData)
            return res
                .status(400)
                .json({ message: "Username incorrect or email is incorrect" });

        const passwordIsValid = await bcrypt.compare(
            req.body.password,
            coachData.password,
        );
        if (!passwordIsValid) {
            return res.status(401).json({ auth: false, token: null });
        }
        var token = jwt.sign(
            { id: coachData.id, coachname: coachData.coachname },
            SECRET_KEY,
            {
                expiresIn: 86400,
            },
        );
        console.log("Logged in coach with ID", coachData.id);
        console.log("username", coachData.coachname);
        res.status(200).json({ auth: true, token: token });
    } catch (err) {
        console.error("Error", err.message);
        res.status(500).send({ error: err.message });
    } finally {
        client.release();
    }
});

app.post("/availabilities", async (req, res) => {
    const {
        coach_id,
        coachname,
        start_time,
        available_date,
        duration,
        capacity,
    } = req.body; //duration takes in minutes
    const client = await pool.connect();

    function addMinutesToHHMM(timeStr, minutesToAdd) {
        const [hh, mm] = timeStr.split(":").map(Number);
        const totalMinutes = hh * 60 + mm + minutesToAdd;
        const newH = Math.floor(totalMinutes / 60) % 24;
        const newM = totalMinutes % 60;
        return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
    }

    try {
        const coachExist = await client.query(
            "SELECT id FROM coaches WHERE id = $1",
            [coach_id],
        );

        if (coachExist.rows.length === 0) {
            return res.status(400).json({ error: "Coach does not exist" });
        }

        const end_time = addMinutesToHHMM(start_time, duration);

        const overlap = await client.query(
            `SELECT 1
         FROM availabilities
        WHERE available_date = $1
          AND start_time     < $3
          AND end_time       > $2
        LIMIT 1`,
            [available_date, start_time, end_time],
        );

        if (overlap.rowCount) {
            return res
                .status(409)
                .json({ error: "Slot overlaps with an existing one." });
        }

        const query = `
      INSERT INTO availabilities (
        coach_id, coachname, start_time, end_time, available_date, capacity
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
        const values = [
            coach_id,
            coachname,
            start_time,
            end_time,
            available_date,
            capacity || null, // allow NULL if not provided
        ];

        const result = await client.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Error", err.message);
        res.status(500).send({ error: err.message });
    } finally {
        client.release();
    }
});

app.put("/availabilities", async (req, res) => {
    const { status, id } = req.body;
    const client = await pool.connect();
    try {
        if (status === "full") {
            await client.query(
                "UPDATE availabilities SET is_fully_booked = TRUE WHERE id = $1",
                [id],
            );
            res.status(200).json({ message: "Marked as fully booked." });
        } else {
            await client.query(
                "UPDATE availabilities SET is_fully_booked = FALSE WHERE id = $1",
                [id],
            );
            res.status(200).json({ message: "Marked as open." });
        }
    } catch (err) {
        console.error(err.stack);
        res.status(500).send("An error occurred, please try again.");
    } finally {
        client.release();
    }
});

app.get("/availabilities", async (req, res) => {
    const { coachtoken, usertoken } = req.query;
    const token = coachtoken || usertoken;

    if (!token) {
        return res.status(401).json({ message: "Unauthorized access" });
    }
    try {
        jwt.verify(token, SECRET_KEY);
    } catch (err) {
        return res.status(401).json({ message: "Invalid token" });
    }

    const client = await pool.connect();
    try {
        const result = await client.query("SELECT * FROM availabilities");
        res.json(result.rows);
    } catch (err) {
        console.error("DB error:", err);
        res.status(500).send("An error occurred.");
    } finally {
        client.release();
    }
});

app.get("/availabilities/coach", async (req, res) => {
    const { coach_id, date } = req.query;
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT * FROM availabilities
       WHERE coach_id = $1 AND available_date = $2 AND is_fully_booked = FALSE`,
            [coach_id, date],
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).send("An error occurred.");
    } finally {
        client.release();
    }
});

app.get("/bookings", async (req, res) => {
    const { user_id, coach_id, userToken, coachToken } = req.query;
    const token = coachToken || userToken;

    if (!token) {
        return res.status(401).json({ message: "Unauthorized access" });
    }

    try {
        jwt.verify(token, SECRET_KEY);
    } catch (err) {
        return res.status(401).json({ message: "Invalid token" });
    }

    const client = await pool.connect();
    try {
        let query = `SELECT * FROM bookings WHERE `;
        const values = [];

        if (user_id) {
            query += `user_id = $1`;
            values.push(user_id);
        }

        if (coach_id) {
            if (user_id) {
                query += ` OR coach_id = $2`;
                values.push(coach_id);
            } else {
                query += `coach_id = $1`;
                values.push(coach_id);
            }
        }

        const result = await client.query(query, values);
        res.json(result.rows);
    } catch (err) {
        console.error("Error in /bookings:", err);
        res.status(500).send("An error occurred.");
    } finally {
        client.release();
    }
});

app.post("/bookings", async (req, res) => {
    const { user_id, available_id } = req.body;
    const client = await pool.connect();

    const alreadybooked = await client.query(
        "SELECT * FROM bookings WHERE user_id = $1 AND available_id = $2",
        [user_id, available_id],
    );
    if (alreadybooked.rows.length > 0) {
        res.status(409).send("You have already booked this slot.");
        return;
    }

    try {
        // 1. Fetch availability status
        const result = await client.query(
            `SELECT is_fully_booked, capacity, current_bookings
       FROM availabilities
       WHERE id = $1`,
            [available_id],
        );

        if (result.rows.length === 0) {
            return res.status(404).send("Availability not found.");
        }

        const slot = result.rows[0];

        // 2. Check if already full (manually marked)
        if (slot.is_fully_booked) {
            return res.status(409).send("This slot is fully booked.");
        }

        // 3. Check capacity limit (if set)
        if (slot.capacity !== null && slot.current_bookings >= slot.capacity) {
            // Optionally: auto-mark full
            await client.query(
                "UPDATE availabilities SET is_fully_booked = TRUE WHERE id = $1",
                [available_id],
            );
            return res.status(409).send("This slot is fully booked.");
        }

        // 4. Proceed with booking
        const booking = await client.query(
            `INSERT INTO bookings (user_id, available_id, created_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       RETURNING *`,
            [user_id, available_id],
        );

        // 5. Update current_bookings count
        await client.query(
            `UPDATE availabilities
       SET current_bookings = current_bookings + 1
       WHERE id = $1`,
            [available_id],
        );

        res.status(201).json(booking.rows[0]);
    } catch (err) {
        console.error("Error", err.message);
        res.status(500).send({ error: err.message });
    } finally {
        client.release();
    }
});

app.delete("/bookings", async (req, res) => {
    const { user_id, available_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query(
            "DELETE FROM bookings WHERE user_id = $1 AND available_id = $2",
            [user_id, available_id],
        );
        await client.query(
            `UPDATE availabilities
       SET current_bookings = current_bookings - 1
       WHERE id = $1 AND current_bookings > 0`,
            [available_id],
        );
        res
            .status(200)
            .json({ message: "The booking has been removed and updated." });
    } catch (err) {
        console.log(err.stack);
        res.status(500).send("An error occured, please try again.");
    } finally {
        client.release();
    }
});

app.delete("/availabilities/:id", async (req, res) => {
    const { id } = req.params;
    const { coachtoken } = req.query;
    const client = await pool.connect();

    if (!coachtoken) {
        return res.status(401).json({ error: "Missing token" });
    }

    let decoded;
    try {
        decoded = jwt.verify(coachtoken, SECRET_KEY);
    } catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }

    const coachIdFromToken = decoded.id;

    try {
        const slot = await client.query(
            `SELECT coach_id FROM availabilities WHERE id = $1`,
            [id],
        );

        if (slot.rows.length === 0) {
            return res.status(404).json({ error: "Slot not found" });
        }

        if (slot.rows[0].coach_id !== coachIdFromToken) {
            return res.status(403).json({ error: "Not your slot" });
        }

        await client.query(`DELETE FROM bookings WHERE available_id = $1`, [id]);

        await client.query(`DELETE FROM availabilities WHERE id = $1`, [id]);

        return res.status(200).json({ message: "Slot deleted" });
    } catch (err) {
        console.error("Delete slot error:", err.message);
        return res.status(500).json({ error: "Server error" });
    } finally {
        client.release();
    }
});

app.put("/bookings", async (req, res) => {
    const { user_id, available_id, new_available_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const update = await client.query(
            "UPDATE bookings SET available_id = $1 WHERE user_id = $2 AND available_id = $3 RETURNING *",
            [new_available_id, user_id, available_id],
        );

        if (update.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Booking not found." });
        }

        await client.query(
            `UPDATE availabilities
       SET current_bookings = current_bookings - 1
       WHERE id = $1 AND current_bookings > 0`,
            [available_id],
        );

        await client.query(
            `UPDATE availabilities
       SET current_bookings = current_bookings + 1
       WHERE id = $1`,
            [new_available_id],
        );

        await client.query("COMMIT");
        res.status(200).json({ message: "The booking has been updated." });
    } catch (err) {
        await client.query("ROLLBACK");
        console.log(err.stack);
        res.status(500).send("An error occurred, please try again.");
    } finally {
        client.release();
    }
});

app.put("/availabilities/:id", async (req, res) => {
    const { id } = req.params;
    const { coachtoken } = req.query;
    const { available_date, start_time, duration, capacity } = req.body;

    function addMinutesToHHMM(timeStr, minutesToAdd) {
        const [hh, mm] = timeStr.split(":").map(Number);
        const totalMinutes = hh * 60 + mm + minutesToAdd;
        const newH = Math.floor(totalMinutes / 60) % 24;
        const newM = totalMinutes % 60;
        return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
    }

    if (!coachtoken) {
        return res.status(401).json({ error: "Unauthorized: Missing token" });
    }

    let coach_id;
    try {
        const decoded = jwt.verify(coachtoken, SECRET_KEY);
        coach_id = decoded.id;
    } catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }

    const client = await pool.connect();
    try {
        const check = await client.query(
            "SELECT * FROM availabilities WHERE id = $1 AND coach_id = $2",
            [id, coach_id]
        );

        if (check.rows.length === 0) {
            return res.status(403).json({ error: "Access denied to this slot." });
        }

        const end_time = addMinutesToHHMM(start_time, duration);

        await client.query(
            `UPDATE availabilities
       SET available_date = $1,
           start_time = $2,
           end_time = $3,
           capacity = $4
       WHERE id = $5`,
            [available_date, start_time, end_time, capacity, id]
        );

        res.status(200).json({ message: "Slot updated successfully." });
    } catch (err) {
        console.error("Edit error:", err);
        res.status(500).json({ error: "Server error during edit." });
    } finally {
        client.release();
    }
});


app.post("/validate-token", (req, res) => {
    const { token } = req.body;
    try {
        jwt.verify(token, SECRET_KEY);
        res.json({ valid: true });
    } catch (err) {
        res.status(401).json({ valid: false });
    }
});

app.get("/", (req, res) => {
    res.status(200).json({ message: "Welcome to the gym API! " });
});

app.listen(3000, () => {
    console.log("App is listening on port 3000");
});
