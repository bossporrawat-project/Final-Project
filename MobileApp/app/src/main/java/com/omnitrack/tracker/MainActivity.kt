package com.omnitrack.tracker

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var tvGpsStatus: TextView
    private lateinit var tvDbStatus: TextView
    private lateinit var etDeviceName: EditText
    private lateinit var etGpsInterval: EditText
    private lateinit var etSyncInterval: EditText

    private val locationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val type = intent?.getStringExtra("type")
            val status = intent?.getStringExtra("status")
            val isError = intent?.getBooleanExtra("error", false) ?: false
            
            if (status != null) {
                if (type == "db") {
                    tvDbStatus.text = "🗄️ Database: $status"
                    tvDbStatus.setTextColor(android.graphics.Color.parseColor(if (isError) "#EF4444" else "#10B981"))
                } else {
                    tvGpsStatus.text = "📍 GPS: $status"
                    tvGpsStatus.setTextColor(android.graphics.Color.parseColor(if (isError) "#EF4444" else "#10B981"))
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvGpsStatus = findViewById(R.id.tvGpsStatus)
        tvDbStatus = findViewById(R.id.tvDbStatus)
        etDeviceName = findViewById(R.id.etDeviceName)
        etGpsInterval = findViewById(R.id.etGpsInterval)
        etSyncInterval = findViewById(R.id.etSyncInterval)
        val btnStart = findViewById<Button>(R.id.btnStartTracking)
        val btnStop = findViewById<Button>(R.id.btnStopTracking)

        // Load Settings
        val prefs = getSharedPreferences("OmniPrefs", Context.MODE_PRIVATE)
        val savedDeviceId = prefs.getString("deviceId", "")
        etDeviceName.setText(savedDeviceId)
        etGpsInterval.setText(prefs.getInt("gpsInterval", 2).toString())
        etSyncInterval.setText(prefs.getInt("syncInterval", 5).toString())

        // Send App Opened status immediately if we have a device ID
        if (!savedDeviceId.isNullOrEmpty()) {
            tvDbStatus.text = "🗄️ Database: Connecting..."
            val supabaseClient = SupabaseClient(this)
            supabaseClient.sendAppStatus(savedDeviceId, "App Opened (Idle)")
        }

        if (!checkPermissions()) {
            requestPermissions()
        }

        btnStart.setOnClickListener {
            if (checkPermissions()) {
                startTrackingService()
            } else {
                requestPermissions()
            }
        }

        btnStop.setOnClickListener {
            stopTrackingService()
        }
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter("LocationUpdate")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(locationReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(locationReceiver, filter)
        }
    }

    override fun onPause() {
        super.onPause()
        unregisterReceiver(locationReceiver)
    }

    private fun startTrackingService() {
        val deviceId = etDeviceName.text.toString().ifEmpty { "Android_Native" }
        val gpsInterval = etGpsInterval.text.toString().toIntOrNull() ?: 2
        val syncInterval = etSyncInterval.text.toString().toIntOrNull() ?: 5
        
        // Save Settings
        val prefs = getSharedPreferences("OmniPrefs", Context.MODE_PRIVATE)
        prefs.edit().apply {
            putString("deviceId", deviceId)
            putInt("gpsInterval", gpsInterval)
            putInt("syncInterval", syncInterval)
            apply()
        }

        val intent = Intent(this, LocationService::class.java).apply {
            action = LocationService.ACTION_START
            putExtra(LocationService.EXTRA_DEVICE_ID, deviceId)
            putExtra("gpsInterval", gpsInterval)
            putExtra("syncInterval", syncInterval)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        tvGpsStatus.text = "📍 GPS: Starting service..."
        tvGpsStatus.setTextColor(android.graphics.Color.parseColor("#F59E0B"))
        tvDbStatus.text = "🗄️ Database: Waiting for GPS..."
        tvDbStatus.setTextColor(android.graphics.Color.parseColor("#F59E0B"))
        Toast.makeText(this, "Tracking Started", Toast.LENGTH_SHORT).show()
    }

    private fun stopTrackingService() {
        val intent = Intent(this, LocationService::class.java).apply {
            action = LocationService.ACTION_STOP
        }
        startService(intent) // stop action is handled inside onStartCommand
        tvGpsStatus.text = "📍 GPS: Stopped"
        tvGpsStatus.setTextColor(android.graphics.Color.parseColor("#94A3B8"))
        tvDbStatus.text = "🗄️ Database: Not connected"
        tvDbStatus.setTextColor(android.graphics.Color.parseColor("#94A3B8"))
        Toast.makeText(this, "Tracking Stopped", Toast.LENGTH_SHORT).show()
    }

    private fun checkPermissions(): Boolean {
        val fineLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val backgroundLocation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        } else true

        return fineLocation && backgroundLocation
    }

    private fun requestPermissions() {
        val fineLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        
        if (!fineLocation) {
            // Step 1: Request Foreground Location
            val permissions = mutableListOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), 100)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Step 2: Request Background Location (Only after foreground is granted)
            val backgroundLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (!backgroundLocation) {
                // Show a toast or dialog explaining why we need background
                Toast.makeText(this, "Please select 'Allow all the time' for background tracking", Toast.LENGTH_LONG).show()
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), 101)
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 100 && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            // Foreground granted, now request background if needed
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                requestPermissions() 
            } else {
                startTrackingService()
            }
        } else if (requestCode == 101 && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            // Background granted
            startTrackingService()
        } else if (requestCode == 100) {
            Toast.makeText(this, "Location permission is required", Toast.LENGTH_LONG).show()
        }
    }
}
