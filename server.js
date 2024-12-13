const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');
const session = require('express-session');

const app = express();
const port = 3000;

// Set up MySQL connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'book_store'
});

db.connect((err) => {
    if (err) {
        throw err;
    }
    console.log('Connected to database');
});

// Set up storage for uploaded images
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static('./public'));
app.use(session({
    secret: 'your_secret_key',  // This can be anything, but should be kept secret in production
    resave: false,     // Don't resave session if nothing has changed
    saveUninitialized: true, // Don't save empty sessions
    cookie: { secure: false } // set 'secure: true' if you're using HTTPS, otherwise 'false'
}));
app.set('view engine', 'ejs');

// Routes

// Landing page - ordering page
app.get('/', (req, res) => {
    // Fetch books from the database
    db.query('SELECT * FROM books', (err, results) => {
        if (err) {
            console.error('Error fetching books:', err);
            return res.status(500).send('Server Error');
        }

        // Render the ordering page and pass the books data
        res.render('ordering-page', { books: results });
    });
});

// Admin login page (GET)
app.get('/admin/login', (req, res) => {
    // Check if user is already logged in
    if (req.session.admin) {
        return res.redirect('/admin/books');  // Redirect if already logged in
    }
    res.render('login');
});

// After login, redirect to the books list or show error (POST)
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;

    db.query('SELECT * FROM admins WHERE username = ?', [username], (err, results) => {
        if (err) {
            console.error('Error querying database:', err);
            return res.status(500).send('Server Error');
        }

        if (results.length > 0) {
            const admin = results[0];
            if (password === admin.password) {
                req.session.admin = admin; // Store session data
                return res.redirect('/admin/books'); // Redirect to admin books page
            } else {
                return res.render('login', { error: 'Invalid password.' });
            }
        } else {
            return res.render('login', { error: 'Username unknown.' });
        }
    });
});

// Admin add book page
app.get('/admin/add-book', (req, res) => {
    if (!req.session.admin) {
        console.log('No session found, redirecting to login');
        return res.redirect('/admin/login'); // Redirect if no admin session
    }

    res.render('add-book', { admin: req.session.admin, error: null });
});

app.post('/admin/add-book', upload.single('image'), (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login'); // Redirect if no admin session
    }

    const { id, name, author, genre, price } = req.body;
    const image = `/uploads/${req.file.filename}`;

    // Check if the book ID already exists in the database
    db.query('SELECT * FROM books WHERE id = ?', [id], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            return res.render('add-book', { error: 'Book ID already exists. Please choose a different ID.' });
        }

        // Insert the new book into the database
        db.query('INSERT INTO books (id, name, author, genre, price, image) VALUES (?, ?, ?, ?, ?, ?)', 
        [id, name, author, genre, price, image], (err, result) => {
            if (err) throw err;
            res.redirect('/admin/books'); // Redirect to books page
        });
    });
});

// Admin books page
app.get('/admin/books', (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login'); // Redirect if no admin session
    }

    db.query('SELECT * FROM books', (err, results) => {
        if (err) {
            console.error('Error fetching books:', err);
            return res.status(500).send('Server Error');
        }

        res.render('books', { books: results });
    });
});

// Route for the Buy Now functionality
app.post('/buy-now', (req, res) => {
    const productData = req.body;
    req.session.selectedProduct = productData; // Store selected product in session
    res.json({ success: true }); // Send confirmation response
});

// Route to display the Buy Now page
app.get('/buy-now', (req, res) => {
    const selectedProduct = req.session.selectedProduct;

    if (!selectedProduct) {
        return res.redirect('/'); // If no product is selected, redirect to the landing page
    }

    res.render('buy-now', { product: selectedProduct });
});

// Route to handle checkout (order completion)
app.post('/checkout', (req, res) => {
    const selectedProduct = req.session.selectedProduct;

    if (!selectedProduct) {
        console.log('No product selected.');
        return res.status(200).json({ success: true }); // Just send success, regardless of no product selected
    }

    const { id, name, price, author, genre, image } = selectedProduct;

    // Insert the order into the orders table
    db.query('INSERT INTO orders (product_id, name, price, author, genre, image) VALUES (?, ?, ?, ?, ?, ?)', 
    [id, name, price, author, genre, image], (err, result) => {
        if (err) {
            console.error('Error inserting order:', err);
            return res.status(200).json({ success: true }); // Always send success, regardless of order insert error
        }

        console.log('Order inserted successfully:', result);

        // Remove the purchased product from the books table
        db.query('DELETE FROM books WHERE id = ?', [id], (err, result) => {
            if (err) {
                console.error('Error deleting book:', err);
                return res.status(200).json({ success: true }); // Always send success, regardless of deletion error
            }

            console.log('Product removed from books table:', result);

            // Clear the selected product from session after order
            req.session.selectedProduct = null;

            // Send a successful response back to the client
            res.json({ success: true }); // Return success response
        });
    });
});

// Route to add item to cart
app.post('/add-to-cart', (req, res) => {
    const item = req.body;
    if (!req.session.cart) {
        req.session.cart = [];
    }
    req.session.cart.push(item);
    res.json({ success: true });
});

// Route to display cart
app.get('/cart', (req, res) => {
    console.log('Cart items:', req.session.cart);  // Log cart contents
    const cart = req.session.cart || [];
    res.render('cart', { cart });
});

// Route to handle selected items and proceed to checkout
app.post('/cart-buy', (req, res) => {
    const selectedItems = req.body.items;
    req.session.itemsToBuy = req.session.cart.filter(item => selectedItems.includes(item.id));
    res.json({ success: true });
});

// Route to display cart-buy page
app.get('/cart-buy', (req, res) => {
    const itemsToBuy = req.session.itemsToBuy || [];
    res.render('cart-buy', { items: itemsToBuy });
});

// Logout route
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.redirect('/'); // Redirect in case of an error
        }
        res.redirect('/'); // Redirect to the ordering page after logout
    });
});

// Order success page
app.get('/order-success', (req, res) => {
    res.send('<h1>Order Successful</h1><p>Thank you for your purchase!</p>');
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port http://localhost:${port}/`);
});
