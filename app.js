// =====================================================================
// OFFLINE SIGNATURE CAPTURE APP - Main Application Logic (FIXED)
// =====================================================================

// Configuration
const CONFIG = {
    // IMPORTANT: Replace this with your Google Apps Script Web App URL
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyIpzWfwmB5uVGQFi5l7RumRqk-F4epCa-z0XTbT_RvJNgW-MsQT_senLewqeufhxly/exec',
    
    // IndexedDB Configuration
    DB_NAME: 'SignatureAppDB',
    DB_VERSION: 1,
    STORE_NAME: 'signatures',
    
    // Canvas Configuration
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 400,
    LINE_WIDTH: 2,
    LINE_COLOR: '#000000',
    
    // Sync Configuration
    AUTO_SYNC_INTERVAL: 30000, // 30 seconds
    MAX_RETRY_ATTEMPTS: 3
};

// Global State
let db = null;
let canvas = null;
let ctx = null;
let isDrawing = false;
let hasSignature = false;
let deferredPrompt = null;
let syncInterval = null;

// =====================================================================
// INITIALIZATION
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 App initializing...');
    
    // Initialize IndexedDB
    await initDB();
    
    // Initialize Canvas
    initCanvas();
    
    // Setup Event Listeners
    setupEventListeners();
    
    // Check online status
    updateOnlineStatus();
    
    // Load pending signatures
    await loadPendingSignatures();
    
    // Update statistics
    updateStats();
    
    // Setup auto-sync
    setupAutoSync();
    
    // Setup PWA install prompt
    setupPWA();
    
    console.log('✅ App initialized successfully');
});

// =====================================================================
// INDEXEDDB SETUP
// =====================================================================

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
        
        request.onerror = () => {
            console.error('❌ IndexedDB error:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            db = request.result;
            console.log('✅ IndexedDB opened successfully');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create object store for signatures
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
                const objectStore = db.createObjectStore(CONFIG.STORE_NAME, { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                
                // Create indexes
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
                objectStore.createIndex('synced', 'synced', { unique: false });
                objectStore.createIndex('customerName', 'customerName', { unique: false });
                
                console.log('✅ Object store created');
            }
        };
    });
}

// =====================================================================
// CANVAS SETUP & SIGNATURE CAPTURE
// =====================================================================

function initCanvas() {
    canvas = document.getElementById('signatureCanvas');
    ctx = canvas.getContext('2d');
    
    // Set canvas size
    const wrapper = canvas.parentElement;
    const rect = wrapper.getBoundingClientRect();
    
    canvas.width = rect.width;
    canvas.height = 200; // Fixed height for mobile
    
    // Configure context
    ctx.strokeStyle = CONFIG.LINE_COLOR;
    ctx.lineWidth = CONFIG.LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    console.log('✅ Canvas initialized:', canvas.width, 'x', canvas.height);
}

function startDrawing(e) {
    isDrawing = true;
    hasSignature = true;
    
    const pos = getPosition(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    
    // Hide placeholder
    document.getElementById('signaturePlaceholder').style.display = 'none';
}

function draw(e) {
    if (!isDrawing) return;
    
    e.preventDefault(); // Prevent scrolling on touch devices
    
    const pos = getPosition(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
}

function stopDrawing() {
    if (!isDrawing) return;
    
    isDrawing = false;
    ctx.closePath();
}

function getPosition(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    
    return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
    };
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSignature = false;
    document.getElementById('signaturePlaceholder').style.display = 'block';
}

function getSignatureDataURL() {
    return canvas.toDataURL('image/png');
}

// =====================================================================
// EVENT LISTENERS
// =====================================================================

function setupEventListeners() {
    // Canvas events - Mouse
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    
    // Canvas events - Touch
    canvas.addEventListener('touchstart', startDrawing);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stopDrawing);
    canvas.addEventListener('touchcancel', stopDrawing);
    
    // Button events
    document.getElementById('clearButton').addEventListener('click', clearCanvas);
    document.getElementById('resetButton').addEventListener('click', resetForm);
    document.getElementById('saveButton').addEventListener('click', saveSignature);
    document.getElementById('syncAllButton').addEventListener('click', syncAllSignatures);
    
    // Signature type change
    document.getElementById('signatureType').addEventListener('change', (e) => {
        const coMakerGroup = document.getElementById('coMakerNameGroup');
        if (e.target.value === 'Co-maker') {
            coMakerGroup.style.display = 'block';
        } else {
            coMakerGroup.style.display = 'none';
        }
    });
    
    // Online/Offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
}

// =====================================================================
// FORM HANDLING
// =====================================================================

function resetForm() {
    document.getElementById('customerName').value = '';
    document.getElementById('signatureType').value = '';
    document.getElementById('coMakerName').value = '';
    document.getElementById('agentId').value = '';
    document.getElementById('notes').value = '';
    document.getElementById('coMakerNameGroup').style.display = 'none';
    clearCanvas();
    
    showMessage('Form reset', 'success');
}

async function saveSignature() {
    // Validate form
    const customerName = document.getElementById('customerName').value.trim();
    const signatureType = document.getElementById('signatureType').value;
    const coMakerName = document.getElementById('coMakerName').value.trim();
    const agentId = document.getElementById('agentId').value.trim();
    const notes = document.getElementById('notes').value.trim();
    
    if (!customerName) {
        showMessage('Please enter customer name', 'error');
        return;
    }
    
    if (!signatureType) {
        showMessage('Please select signature type', 'error');
        return;
    }
    
    if (signatureType === 'Co-maker' && !coMakerName) {
        showMessage('Please enter co-maker name', 'error');
        return;
    }
    
    if (!hasSignature) {
        showMessage('Please provide a signature', 'error');
        return;
    }
    
    // Get signature data
    const signatureDataURL = getSignatureDataURL();
    
    // Create signature object
    const signature = {
        customerName,
        signatureType,
        coMakerName: signatureType === 'Co-maker' ? coMakerName : '',
        agentId,
        notes,
        signatureData: signatureDataURL,
        timestamp: new Date().toISOString(),
        synced: false,
        syncAttempts: 0
    };
    
    try {
        // Save to IndexedDB
        await saveToIndexedDB(signature);
        
        showMessage('✅ Signature saved locally!', 'success');
        
        // Reset form
        resetForm();
        
        // Update UI
        await loadPendingSignatures();
        updateStats();
        
        // Try to sync if online
        if (navigator.onLine) {
            await syncAllSignatures();
        }
        
    } catch (error) {
        console.error('Error saving signature:', error);
        showMessage('❌ Error saving signature: ' + error.message, 'error');
    }
}

// =====================================================================
// INDEXEDDB OPERATIONS (FIXED)
// =====================================================================

function saveToIndexedDB(signature) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(CONFIG.STORE_NAME);
        const request = objectStore.add(signature);
        
        request.onsuccess = () => {
            console.log('✅ Signature saved to IndexedDB:', request.result);
            resolve(request.result);
        };
        
        request.onerror = () => {
            console.error('❌ Error saving to IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

function getAllSignatures() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_NAME], 'readonly');
        const objectStore = transaction.objectStore(CONFIG.STORE_NAME);
        const request = objectStore.getAll();
        
        request.onsuccess = () => {
            resolve(request.result);
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

// FIXED: Proper IndexedDB query for pending signatures
function getPendingSignatures() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_NAME], 'readonly');
        const objectStore = transaction.objectStore(CONFIG.STORE_NAME);
        const index = objectStore.index('synced');
        
        // Method 1: Using IDBKeyRange (more efficient)
        try {
            const keyRange = IDBKeyRange.only(false);
            const request = index.getAll(keyRange);
            
            request.onsuccess = () => {
                resolve(request.result || []);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        } catch (error) {
            // Fallback: If IDBKeyRange fails, use cursor method
            console.log('Using cursor fallback method');
            const results = [];
            const cursorRequest = index.openCursor();
            
            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (cursor.value.synced === false) {
                        results.push(cursor.value);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            
            cursorRequest.onerror = () => {
                reject(cursorRequest.error);
            };
        }
    });
}

function updateSignature(id, updates) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(CONFIG.STORE_NAME);
        const request = objectStore.get(id);
        
        request.onsuccess = () => {
            const signature = request.result;
            if (!signature) {
                reject(new Error('Signature not found'));
                return;
            }
            
            Object.assign(signature, updates);
            
            const updateRequest = objectStore.put(signature);
            
            updateRequest.onsuccess = () => {
                resolve(signature);
            };
            
            updateRequest.onerror = () => {
                reject(updateRequest.error);
            };
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

function deleteSignature(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(CONFIG.STORE_NAME);
        const request = objectStore.delete(id);
        
        request.onsuccess = () => {
            resolve();
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

// =====================================================================
// SYNC FUNCTIONALITY
// =====================================================================

async function syncAllSignatures() {
    if (!navigator.onLine) {
        showMessage('📡 You are offline. Signatures will sync when online.', 'error');
        return;
    }
    
    if (!CONFIG.GOOGLE_SCRIPT_URL || CONFIG.GOOGLE_SCRIPT_URL.includes('YOUR_GOOGLE')) {
        showMessage('⚠️ Google Script URL not configured', 'error');
        return;
    }
    
    let pendingSignatures;
    try {
        pendingSignatures = await getPendingSignatures();
    } catch (error) {
        console.error('Error getting pending signatures:', error);
        showMessage('❌ Error loading pending signatures', 'error');
        return;
    }
    
    if (pendingSignatures.length === 0) {
        showMessage('✅ All signatures synced!', 'success');
        return;
    }
    
    showLoading(true);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const signature of pendingSignatures) {
        try {
            const success = await syncSignature(signature);
            
            if (success) {
                await updateSignature(signature.id, {
                    synced: true,
                    syncedAt: new Date().toISOString()
                });
                successCount++;
            } else {
                await updateSignature(signature.id, {
                    syncAttempts: signature.syncAttempts + 1
                });
                failCount++;
            }
        } catch (error) {
            console.error('Sync error for signature:', signature.id, error);
            failCount++;
        }
    }
    
    showLoading(false);
    
    // Update UI
    await loadPendingSignatures();
    updateStats();
    
    if (successCount > 0) {
        showMessage(`✅ Synced ${successCount} signature(s)`, 'success');
    }
    
    if (failCount > 0) {
        showMessage(`⚠️ Failed to sync ${failCount} signature(s)`, 'error');
    }
}

async function syncSignature(signature) {
    try {
        const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'saveSignature',
                data: {
                    customerName: signature.customerName,
                    signatureType: signature.signatureType,
                    coMakerName: signature.coMakerName,
                    agentId: signature.agentId,
                    notes: signature.notes,
                    signatureData: signature.signatureData,
                    timestamp: signature.timestamp
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Signature synced:', signature.id);
            return true;
        } else {
            console.error('❌ Sync failed:', result.error);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Sync error:', error);
        return false;
    }
}

function setupAutoSync() {
    // Clear existing interval
    if (syncInterval) {
        clearInterval(syncInterval);
    }
    
    // Setup new interval
    syncInterval = setInterval(async () => {
        if (navigator.onLine) {
            console.log('🔄 Auto-sync triggered...');
            try {
                const pendingCount = (await getPendingSignatures()).length;
                
                if (pendingCount > 0) {
                    await syncAllSignatures();
                }
            } catch (error) {
                console.error('Auto-sync error:', error);
            }
        }
    }, CONFIG.AUTO_SYNC_INTERVAL);
    
    console.log('✅ Auto-sync enabled (every 30 seconds)');
}

// =====================================================================
// UI UPDATES
// =====================================================================

async function loadPendingSignatures() {
    let pendingSignatures;
    try {
        pendingSignatures = await getPendingSignatures();
    } catch (error) {
        console.error('Error loading pending signatures:', error);
        return;
    }
    
    const pendingList = document.getElementById('pendingList');
    const pendingSection = document.getElementById('pendingSection');
    
    if (pendingSignatures.length === 0) {
        pendingSection.style.display = 'none';
        return;
    }
    
    pendingSection.style.display = 'block';
    
    pendingList.innerHTML = pendingSignatures.map(sig => {
        const date = new Date(sig.timestamp);
        const displayName = sig.signatureType === 'Co-maker' 
            ? `${sig.customerName} (Co-maker: ${sig.coMakerName})`
            : sig.customerName;
        
        return `
            <div class="pending-item">
                <div class="pending-item-header">
                    <span class="pending-item-name">${displayName}</span>
                    <span class="pending-item-time">${date.toLocaleString()}</span>
                </div>
                <div class="pending-item-details">
                    Type: ${sig.signatureType} | 
                    Attempts: ${sig.syncAttempts || 0} |
                    Agent: ${sig.agentId || 'N/A'}
                </div>
            </div>
        `;
    }).join('');
}

async function updateStats() {
    try {
        const allSignatures = await getAllSignatures();
        const pendingSignatures = await getPendingSignatures();
        
        document.getElementById('savedCount').textContent = allSignatures.length;
        document.getElementById('pendingCount').textContent = pendingSignatures.length;
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

function showMessage(message, type) {
    const successEl = document.getElementById('successMessage');
    const errorEl = document.getElementById('errorMessage');
    
    if (type === 'success') {
        successEl.textContent = message;
        successEl.style.display = 'block';
        errorEl.style.display = 'none';
        
        setTimeout(() => {
            successEl.style.display = 'none';
        }, 5000);
    } else {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        successEl.style.display = 'none';
        
        setTimeout(() => {
            errorEl.style.display = 'none';
        }, 5000);
    }
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = show ? 'flex' : 'none';
}

// =====================================================================
// ONLINE/OFFLINE HANDLING
// =====================================================================

function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    const indicator = document.getElementById('statusIndicator');
    const syncText = document.getElementById('syncText');
    
    if (isOnline) {
        indicator.classList.remove('offline');
        syncText.textContent = 'Online';
    } else {
        indicator.classList.add('offline');
        syncText.textContent = 'Offline';
    }
}

async function handleOnline() {
    console.log('🌐 Connection restored');
    updateOnlineStatus();
    showMessage('📡 Connection restored. Syncing...', 'success');
    
    // Auto-sync when coming online
    setTimeout(async () => {
        await syncAllSignatures();
    }, 1000);
}

function handleOffline() {
    console.log('📡 Connection lost');
    updateOnlineStatus();
    showMessage('📡 You are offline. Signatures will be saved locally.', 'error');
}

// =====================================================================
// PWA INSTALLATION
// =====================================================================

function setupPWA() {
    // Listen for install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        
        // Show install prompt
        const installPrompt = document.getElementById('installPrompt');
        installPrompt.style.display = 'flex';
        
        console.log('📱 Install prompt ready');
    });
    
    // Install button click
    document.getElementById('installButton').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        
        deferredPrompt.prompt();
        
        const { outcome } = await deferredPrompt.userChoice;
        
        if (outcome === 'accepted') {
            console.log('✅ App installed');
            showMessage('✅ App installed successfully!', 'success');
        }
        
        deferredPrompt = null;
        document.getElementById('installPrompt').style.display = 'none';
    });
    
    // Listen for app installed
    window.addEventListener('appinstalled', () => {
        console.log('✅ PWA installed');
        deferredPrompt = null;
    });
}

// =====================================================================
// SERVICE WORKER REGISTRATION
// =====================================================================

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(registration => {
            console.log('✅ Service Worker registered:', registration.scope);
        })
        .catch(error => {
            console.error('❌ Service Worker registration failed:', error);
        });
}