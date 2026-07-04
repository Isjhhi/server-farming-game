const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // Library pengaman password
const jwt = require('jsonwebtoken'); // TAMBAHAN: Library Token Keamanan
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const RATIO_CASHPOINT_KE_RUPIAH = 1; 
const JWT_SECRET = process.env.JWT_SECRET || "SUPER_RAHASIA_DEV_GAME_FARMING_2026"; // Kunci rahasia token

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

// --- FUNGSI BANTUAN: MENDAPATKAN IP PENGGUNA ---
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || "Unknown";
}

// --- MIDDLEWARE: VALIDASI TOKEN (KEAMANAN API) ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <TOKEN>"
    
    if (!token) return res.status(401).json({ status: "error", message: "Akses ditolak! Harus login." });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ status: "error", message: "Sesi tidak valid / Kadaluarsa!" });
        req.user = user; // Menyimpan data user dari token ke dalam request
        next();
    });
}

// --- SKEMA DATABASE ---
const UserSchema = new mongoose.Schema({
    nomor_dana: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    farm_coin: { type: Number, default: 0 },
    cash_point: { type: Number, default: 0 },
    jumlah_bibit: { type: Number, default: 3 },
    jumlah_lahan: { type: Number, default: 1 },
    daily_ads: { type: Number, default: 0 },
    last_ip: { type: String, default: "-" } // TAMBAHAN: Menyimpan IP pengguna
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

// --- ENDPOINT: REGISTER ---
app.post('/api/register', async (req, res) => {
    try {
        const { nomor_dana, password } = req.body;

        let userSama = await User.findOne({ nomor_dana });
        if (userSama) {
            return res.status(400).json({ status: "error", message: "Nomor DANA sudah terdaftar!" });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const userIp = getClientIp(req);

        await User.create({
            nomor_dana,
            password: hashedPassword,
            last_ip: userIp
        });

        res.json({ status: "success", message: "Registrasi Akun Berhasil!" });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

// --- ENDPOINT: LOGIN ---
app.post('/api/login', async (req, res) => {
    try {
        const { nomor_dana, password } = req.body;

        const user = await User.findOne({ nomor_dana });
        if (!user) {
            return res.status(404).json({ status: "error", message: "Nomor DANA belum terdaftar!" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ status: "error", message: "Password salah!" });
        }

        // TAMBAHAN: Buat Token JWT (Berlaku 7 Hari) dan Update IP
        const token = jwt.sign({ nomor_dana: user.nomor_dana }, JWT_SECRET, { expiresIn: '7d' });
        
        user.last_ip = getClientIp(req);
        await user.save();

        const currentPoin = await getPoinPerIklan();
        res.json({ 
            status: "success", 
            message: "Login Berhasil!",
            token: token, // Kirim token ke client
            user: { ...user._doc, poin_per_iklan: currentPoin }
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

// --- API ENDPOINTS (DILINDUNGI JWT) ---

app.get('/api/get-saldo/:nomor_dana', authenticateToken, async (req, res) => {
    try {
        // Cek Keamanan: Pastikan token sesuai dengan nomor dana yang diminta
        if (req.user.nomor_dana !== req.params.nomor_dana) {
            return res.status(403).json({ status: "error", message: "Ilegal: Tidak bisa melihat data akun lain!" });
        }

        let user = await User.findOne({ nomor_dana: req.params.nomor_dana });
        if (!user) return res.status(404).json({ status: "error", message: "User tidak ditemukan" });
        const currentPoin = await getPoinPerIklan();
        res.json({ ...user._doc, poin_per_iklan: currentPoin });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

app.post('/api/update-all', authenticateToken, async (req, res) => {
    try {
        const { nomor_dana, farm_coin, cash_point, jumlah_bibit, jumlah_lahan, daily_ads } = req.body;
        
        // Cek Keamanan: Cegah manipulasi nomor dana lewat request payload
        if (req.user.nomor_dana !== nomor_dana) {
            return res.status(403).json({ status: "error", message: "Ilegal: Manipulasi data akun lain terdeteksi!" });
        }

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

app.post('/api/withdraw', authenticateToken, async (req, res) => {
    try {
        const { nomor_dana, nominal, bersih, cash_point_sekarang } = req.body;
        
        if (req.user.nomor_dana !== nomor_dana) {
            return res.status(403).json({ status: "error", message: "Ilegal: Aksi tidak sah!" });
        }

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

app.get('/api/history/:nomor_dana', authenticateToken, async (req, res) => {
    try {
        if (req.user.nomor_dana !== req.params.nomor_dana) return res.status(403).json({ status: "error" });
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
        
        // MODIFIKASI: Ditambahkan form Edit Saldo Bebas (Bisa plus/minus) dan IP
        let playerRows = users.map(u => `
            <tr>
                <td><strong>${u.nomor_dana}</strong><br><small style="color:gray;">IP: ${u.last_ip}</small></td>
                <td><span style="background: #e2f0d9; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${u.farm_coin}</span></td>
                <td><span style="background: #fff3cd; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${u.cash_point}</span></td>
                <td>${u.jumlah_bibit}</td>
                <td>${u.jumlah_lahan}</td>
                <td>${u.daily_ads}</td>
                <td>
                    <form action="/admin/change-password" method="POST" style="display:inline-flex; gap: 5px;">
                        <input type="hidden" name="nomor_dana" value="${u.nomor_dana}">
                        <input type="text" name="password_baru" placeholder="Sandi Baru" required style="padding: 4px; border: 1px solid #ddd; border-radius:4px; width: 100px;">
                        <input type="submit" value="Ganti" class="btn-success" style="padding: 4px 8px; font-size: 13px;">
                    </form>
                </td>
                <td>
                    <form action="/admin/edit-saldo" method="POST" style="display:inline-flex; gap: 5px; flex-direction:column;">
                        <input type="hidden" name="nomor_dana" value="${u.nomor_dana}">
                        <select name="jenis_saldo" style="padding: 4px; border: 1px solid #ddd; border-radius:4px;">
                            <option value="cash_point">Cash Point</option>
                            <option value="farm_coin">Farm Coin</option>
                        </select>
                        <div style="display:inline-flex; gap: 5px;">
                            <input type="number" name="jumlah" placeholder="+/- Jumlah" required style="padding: 4px; border: 1px solid #ddd; border-radius:4px; width: 90px;" title="Gunakan minus (-) untuk mengurangi">
                            <input type="submit" value="Terapkan" class="btn-info" style="padding: 4px 8px; font-size: 13px;">
                        </div>
                    </form>
                </td>
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
                    .btn-info { background: #17a2b8; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;}
                    .btn-info:hover { background: #138496; }
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
                                <th>Data Pemain</th>
                                <th>Farm Coin</th>
                                <th>Cash Point</th>
                                <th>Stok Bibit</th>
                                <th>Lahan Terbuka</th>
                                <th>Iklan Hari Ini</th>
                                <th>Aksi Ganti Password</th>
                                <th>Edit Saldo (Bisa Minus)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${playerRows.length > 0 ? playerRows : '<tr><td colspan="8" style="text-align:center;">Belum ada data pemain</td></tr>'}
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

// --- ROUTE ACTION: PROSES GANTI PASSWORD ---
app.post('/admin/change-password', async (req, res) => {
    try {
        const { nomor_dana, password_baru } = req.body;
        if (!nomor_dana || !password_baru) return res.status(400).send("Input tidak boleh kosong!");

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password_baru, salt);

        await User.findOneAndUpdate({ nomor_dana: nomor_dana }, { password: hashedPassword });
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Gagal mengubah password: " + err.message);
    }
});

// --- NEW ROUTE ACTION: PROSES EDIT SALDO VIA WEB ADMIN ---
app.post('/admin/edit-saldo', async (req, res) => {
    try {
        const { nomor_dana, jenis_saldo, jumlah } = req.body;
        if (!nomor_dana || !jenis_saldo || !jumlah) return res.status(400).send("Input tidak lengkap!");

        // Objek update dinamis berdasarkan pilihan dropdown
        let updateData = {};
        updateData[jenis_saldo] = parseInt(jumlah); // $inc bisa menambah (+) atau mengurangi jika nilainya minus (-)

        await User.findOneAndUpdate(
            { nomor_dana: nomor_dana },
            { $inc: updateData }
        );

        res.redirect('/admin'); 
    } catch (err) {
        res.status(500).send("Gagal mengedit saldo: " + err.message);
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

app.listen(process.env.PORT || 8080, () => console.log("Server online dengan keamanan JWT aktif!"));
