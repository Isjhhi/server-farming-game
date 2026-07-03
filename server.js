const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // Library pengaman password
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const RATIO_CASHPOINT_KE_RUPIAH = 1; 

let localConfig = { poin_per_iklan: 10 };
try {
    localConfig = require('./config');
} catch (e) {
    console.log("config.js tidak ditemukan, menggunakan fallback default.");
}

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin_game:i42qqjW%3AS.cX2BU@cluster0.sqwnrap.mongodb.net/farming_game?retryWrites=true&w=majority"; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("Terhubung ke MongoDB Cloud!"))
    .catch(err => console.error("Gagal konek MongoDB:", err));

// --- SKEMA DATABASE (DITAMBAH FIELD PASSWORD) ---
const UserSchema = new mongoose.Schema({
    nomor_dana: { type: String, unique: true, required: true },
    password: { type: String, required: true }, // Field Baru!
    farm_coin: { type: Number, default: 0 },
    cash_point: { type: Number, default: 0 },
    jumlah_bibit: { type: Number, default: 3 },
    jumlah_lahan: { type: Number, default: 1 },
    daily_ads: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

const WithdrawSchema = new mongoose.Schema({
    nomor_dana: { type: String, required: true },
    nominal: { type: Number, required: true },
    bersih: { type: Number, required: true },
    status: { type: String, default: "Pending" },
    tanggal: { type: String, default: () => new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) }
});
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

const ConfigSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed
});
const Config = mongoose.model('Config', ConfigSchema);

async function getPoinPerIklan() {
    try {
        const doc = await Config.findOne({ key: 'poin_per_iklan' });
        return doc ? parseInt(doc.value) : localConfig.poin_per_iklan;
    } catch (err) {
        return localConfig.poin_per_iklan;
    }
}

// --- NEW ENDPOINT: REGISTER ---
app.post('/api/register', async (req, res) => {
    try {
        const { nomor_dana, password } = req.body;

        // Cek apakah nomor HP sudah dipakai orang lain
        let userSama = await User.findOne({ nomor_dana });
        if (userSama) {
            return res.status(400).json({ status: "error", message: "Nomor DANA sudah terdaftar!" });
        }

        // Enkripsi / Acak password biar aman
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Bikin akun baru di database
        const userBaru = await User.create({
            nomor_dana,
            password: hashedPassword
        });

        res.json({ status: "success", message: "Registrasi Akun Berhasil!" });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

// --- NEW ENDPOINT: LOGIN ---
app.post('/api/login', async (req, res) => {
    try {
        const { nomor_dana, password } = req.body;

        // Cari user berdasarkan nomor dana
        const user = await User.findOne({ nomor_dana });
        if (!user) {
            return res.status(404).json({ status: "error", message: "Nomor DANA belum terdaftar!" });
        }

        // Cocokkan password yang diketik dengan yang di database
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ status: "error", message: "Password salah!" });
        }

        // Kalau sukses, langsung kirim seluruh data saldo game-nya biar hemat request
        const currentPoin = await getPoinPerIklan();
        res.json({ 
            status: "success", 
            message: "Login Berhasil!",
            user: { ...user._doc, poin_per_iklan: currentPoin }
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

// --- API ENDPOINTS LAINNYA ---
app.get('/api/get-saldo/:nomor_dana', async (req, res) => {
    try {
        let user = await User.findOne({ nomor_dana: req.params.nomor_dana });
        if (!user) return res.status(404).json({ status: "error", message: "User tidak ditemukan" });
        const currentPoin = await getPoinPerIklan();
        res.json({ ...user._doc, poin_per_iklan: currentPoin });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

app.post('/api/update-all', async (req, res) => {
    try {
        const { nomor_dana, farm_coin, cash_point, jumlah_bibit, jumlah_lahan, daily_ads } = req.body;
        let user = await User.findOneAndUpdate(
            { nomor_dana: nomor_dana },
            { farm_coin, cash_point, jumlah_bibit, jumlah_lahan, daily_ads },
            { new: true }
        );
        res.json({ status: "success", user });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { nomor_dana, nominal, bersih, cash_point_sekarang } = req.body;
        let user = await User.findOne({ nomor_dana });
        if (!user) return res.status(404).json({ status: "error", message: "User tidak ditemukan" });

        user.cash_point = cash_point_sekarang;
        await user.save();

        await Withdraw.create({
            nomor_dana,
            nominal,
            bersih,
            status: "Pending"
        });

        res.json({ status: "success", new_cash_point: user.cash_point });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

app.get('/api/history/:nomor_dana', async (req, res) => {
    try {
        const history = await Withdraw.find({ nomor_dana: req.params.nomor_dana }).sort({ _id: -1 });
        res.json(history);
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

// --- WEB ADMIN PANEL ---
app.get('/admin', async (req, res) => {
    try {
        const users = await User.find({});
        const wds = await Withdraw.find({}).sort({ _id: -1 });
        const currentPoin = await getPoinPerIklan();
        
        let playerRows = users.map(u => `
            <tr>
                <td><strong>${u.nomor_dana}</strong></td>
                <td>${u.farm_coin}</td>
                <td>${u.cash_point}</td>
                <td>${u.jumlah_bibit}</td>
                <td>${u.jumlah_lahan}</td>
                <td>${u.daily_ads}</td>
            </tr>
        `).join('');

        let wdRows = wds.map(w => {
            let colorStatus = "orange";
            if (w.status === "Sukses") colorStatus = "green";
            if (w.status === "Gagal") colorStatus = "red";

            return `
                <tr>
                    <td>${w.tanggal}</td>
                    <td><strong>${w.nomor_dana}</strong></td>
                    <td>Rp ${w.nominal.toLocaleString()}</td>
                    <td>Rp ${w.bersih.toLocaleString()}</td>
                    <td style="color: ${colorStatus}"><strong>${w.status}</strong></td>
                    <td>
                        ${w.status === 'Pending' ? `
                            <form action="/admin/approve-wd" method="POST" style="display:inline;">
                                <input type="hidden" name="wd_id" value="${w._id}">
                                <input type="submit" value="Terima" class="btn-success">
                            </form>
                            <form action="/admin/reject-wd" method="POST" style="display:inline; margin-left: 5px;">
                                <input type="hidden" name="wd_id" value="${w._id}">
                                <input type="submit" value="Tolak" class="btn-danger">
                            </form>
                        ` : `✔ ${w.status}`}
                    </td>
                </tr>
            `;
        }).join('');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Admin Panel - Control Center</title>
                <style>
                    body { font-family: sans-serif; margin: 30px; background: #f4f6f9; color: #333; }
                    .card { background: white; padding: 20px; border-radius: 6px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 25px; }
                    table { width: 100%; border-collapse: collapse; background: white; margin-top: 10px; }
                    th, td { padding: 12px; border: 1px solid #ddd; text-align: left; }
                    th { background: #007bff; color: white; }
                    .btn-success { background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;}
                    .btn-success:hover { background: #218838; }
                    .btn-danger { background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;}
                    .btn-danger:hover { background: #c82333; }
                </style>
            </head>
            <body>
                <h2>Dashboard Utama Control Panel</h2>
                
                <div class="card">
                    <h3>Setelan Global Game Variable</h3>
                    <form action="/admin/update-config" method="POST">
                        <p>Poin Per Iklan Aktif: <strong>${currentPoin} Poin</strong></p>
                        <input type="number" name="poin_per_iklan" value="${currentPoin}" required>
                        <input type="submit" value="Simpan & Terapkan" style="padding: 6px 12px; cursor:pointer;">
                    </form>
                </div>

                <div class="card">
                    <h3>Daftar Permintaan Penarikan (Withdraw)</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Tanggal Request</th>
                                <th>Nomor DANA</th>
                                <th>Nominal Tarik</th>
                                <th>Diterima Bersih (Potong 20%)</th>
                                <th>Status</th>
                                <th>Aksi / Tindakan</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${wdRows.length > 0 ? wdRows : '<tr><td colspan="6" style="text-align:center;">Belum ada request penarikan.</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <div class="card">
                    <h3>Data Total Pemain Terdaftar</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Nomor DANA</th>
                                <th>Farm Coin</th>
                                <th>Cash Point</th>
                                <th>Stok Bibit</th>
                                <th>Lahan Terbuka</th>
                                <th>Iklan Hari Ini</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${playerRows.length > 0 ? playerRows : '<tr><td colspan="6" style="text-align:center;">Belum ada data pemain</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("Admin Panel Error: " + err.message);
    }
});

app.post('/admin/approve-wd', async (req, res) => {
    try {
        const { wd_id } = req.body;
        await Withdraw.findByIdAndUpdate(wd_id, { status: "Sukses" });
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Gagal menyetujui WD: " + err.message);
    }
});

app.post('/admin/reject-wd', async (req, res) => {
    try {
        const { wd_id } = req.body;
        const wdData = await Withdraw.findById(wd_id);
        if (!wdData) return res.status(404).send("Data WD tidak ditemukan");

        if (wdData.status === "Pending") {
            const poinDikembalikan = wdData.nominal / RATIO_CASHPOINT_KE_RUPIAH;
            await User.findOneAndUpdate(
                { nomor_dana: wdData.nomor_dana },
                { $inc: { cash_point: poinDikembalikan } }
            );
            wdData.status = "Gagal";
            await wdData.save();
        }
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Gagal menolak WD: " + err.message);
    }
});

app.post('/admin/update-config', async (req, res) => {
    try {
        const { poin_per_iklan } = req.body;
        await Config.findOneAndUpdate({ key: 'poin_per_iklan' }, { value: parseInt(poin_per_iklan) }, { upsert: true });
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Gagal update config: " + err.message);
    }
});

app.listen(process.env.PORT || 8080, () => console.log("Server online!"));
