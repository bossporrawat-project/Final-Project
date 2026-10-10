package com.omnitrack.tracker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class LocationService : Service() {

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var supabaseClient: SupabaseClient
    private var wakeLock: PowerManager.WakeLock? = null
    
    private var gpsInterval: Int = 2
    private var syncInterval: Int = 5
    private var deviceId: String = "Android_Native"
    
    // Sync Queue
    private val locationQueue = mutableListOf<android.location.Location>()
    private var syncRunnable: Runnable? = null
    private val handler = android.os.Handler(Looper.getMainLooper())

    companion object {
        const val CHANNEL_ID = "LocationServiceChannel"
        const val ACTION_START = "START_TRACKING"
        const val ACTION_STOP = "STOP_TRACKING"
        const val EXTRA_DEVICE_ID = "DEVICE_ID"
    }

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        supabaseClient = SupabaseClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_START) {
            deviceId = intent.getStringExtra(EXTRA_DEVICE_ID) ?: "Android_Native"
            gpsInterval = intent.getIntExtra("gpsInterval", 2)
            syncInterval = intent.getIntExtra("syncInterval", 5)
            
            startForegroundService()
            acquireWakeLock()
            requestLocationUpdates()
            startSyncTimer()
        } else if (intent?.action == ACTION_STOP) {
            releaseWakeLock()
            stopForeground(true)
            stopSelf()
        }
        return START_STICKY
    }

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OmniTracker::LocationWakeLock")
            wakeLock?.acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }

    private fun startSyncTimer() {
        syncRunnable?.let { handler.removeCallbacks(it) }
        syncRunnable = object : Runnable {
            override fun run() {
                val batch = synchronized(locationQueue) {
                    val copy = locationQueue.toList()
                    locationQueue.clear()
                    copy
                }
                
                if (batch.isNotEmpty()) {
                    supabaseClient.batchUpsertPosition(deviceId, batch)
                }
                
                handler.postDelayed(this, syncInterval * 1000L)
            }
        }
        handler.postDelayed(syncRunnable!!, syncInterval * 1000L)
    }

    private fun startForegroundService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "Omni Tracker Background Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }

        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Omni Tracker (Native)")
            .setContentText("Tracking every ${gpsInterval}s, Syncing every ${syncInterval}s")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .build()

        startForeground(1, notification)
    }

    private fun requestLocationUpdates() {
        // Broadcast that we are waiting for GPS lock
        val initIntent = Intent("LocationUpdate").apply { setPackage(packageName) }
        initIntent.putExtra("status", "Waiting for GPS signal lock...\n(If indoors, this may take a minute)")
        sendBroadcast(initIntent)

        try {
            // Immediately fetch last known location to make it feel faster
            fusedLocationClient.lastLocation.addOnSuccessListener { location ->
                if (location != null) {
                    synchronized(locationQueue) {
                        locationQueue.add(location)
                    }
                    val lat = location.latitude
                    val lng = location.longitude
                    val speed = (location.speed * 3.6).toFloat()
                    val timeString = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date(location.time))
                    
                    val intent = Intent("LocationUpdate").apply { setPackage(packageName) }
                    intent.putExtra("status", "Lat: $lat, Lng: $lng\nSpeed: $speed km/h\nAcc: ${location.accuracy} m (Cached)\nTime: $timeString\nQueue: ${locationQueue.size}")
                    sendBroadcast(intent)
                }
            }

            // Force an immediate fresh location query
            fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                .addOnSuccessListener { location ->
                    if (location != null) {
                        synchronized(locationQueue) {
                            if (!locationQueue.contains(location)) {
                                locationQueue.add(location)
                            }
                        }
                    }
                }

            val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, gpsInterval * 1000L)
                .setMinUpdateIntervalMillis(gpsInterval * 1000L / 2)
                .build()

            locationCallback = object : LocationCallback() {
                override fun onLocationResult(locationResult: LocationResult) {
                    for (location in locationResult.locations) {
                        synchronized(locationQueue) {
                            locationQueue.add(location)
                        }
                        
                        val lat = location.latitude
                        val lng = location.longitude
                        val speed = (location.speed * 3.6).toFloat() // m/s to km/h
                        val accuracy = location.accuracy
                        val timeString = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date(location.time))
                        
                        // Broadcast to UI
                        val intent = Intent("LocationUpdate").apply { setPackage(packageName) }
                        intent.putExtra("status", "Lat: $lat, Lng: $lng\nSpeed: $speed km/h\nAcc: $accuracy m\nTime: $timeString\nQueue: ${locationQueue.size}")
                        sendBroadcast(intent)
                    }
                }
            }

            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            )
        } catch (e: SecurityException) {
            val errIntent = Intent("LocationUpdate").apply { setPackage(packageName) }
            errIntent.putExtra("status", "Error: Location permission missing!")
            sendBroadcast(errIntent)
        } catch (e: Exception) {
            val errIntent = Intent("LocationUpdate").apply { setPackage(packageName) }
            errIntent.putExtra("status", "Error: ${e.message}")
            sendBroadcast(errIntent)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        releaseWakeLock()
        if (::locationCallback.isInitialized) {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        }
        syncRunnable?.let { handler.removeCallbacks(it) }
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
