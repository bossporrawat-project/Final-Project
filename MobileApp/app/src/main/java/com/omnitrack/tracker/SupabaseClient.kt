package com.omnitrack.tracker

import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class SupabaseClient(private val context: android.content.Context) {
    private val client = OkHttpClient()
    
    // Hardcoded keys from the user's environment for simplicity
    private val supabaseUrl = "https://ryuhkaytmlapkuumgnlo.supabase.co"
    private val supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dWhrYXl0bWxhcGt1dW1nbmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MzY4MjUsImV4cCI6MjEwNzExMjgyNX0.JYKrvAMK64xE5r92pepQy02fVl4mO55dMaz93heaee8"

    private fun broadcastDbStatus(status: String, isError: Boolean = false) {
        val intent = android.content.Intent("LocationUpdate")
        intent.setPackage(context.packageName)
        intent.putExtra("type", "db")
        intent.putExtra("status", status)
        intent.putExtra("error", isError)
        context.sendBroadcast(intent)
    }

    fun sendAppStatus(deviceId: String, appStatus: String) {
        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.getDefault())
        isoFormat.timeZone = TimeZone.getTimeZone("UTC")
        val now = isoFormat.format(Date())

        val json = JSONObject()
        json.put("device_id", deviceId)
        json.put("device_name", deviceId)
        json.put("latitude", 0.0) // Dummy coordinate for status update
        json.put("longitude", 0.0)
        json.put("app_status", appStatus)
        json.put("source", "native")
        json.put("is_online", true)
        json.put("updated_at", now)

        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("$supabaseUrl/rest/v1/gps_positions?on_conflict=device_id")
            .addHeader("apikey", supabaseKey)
            .addHeader("Authorization", "Bearer $supabaseKey")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "resolution=merge-duplicates")
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                broadcastDbStatus("Network Error: ${e.message}", true)
            }
            override fun onResponse(call: Call, response: Response) {
                if (response.isSuccessful) {
                    broadcastDbStatus("App Status Synced")
                } else {
                    val errorBody = response.body?.string() ?: "Unknown Error"
                    broadcastDbStatus("HTTP ${response.code}: $errorBody", true)
                }
                response.close()
            }
        })
    }

    fun batchUpsertPosition(deviceId: String, locations: List<android.location.Location>) {
        if (locations.isEmpty()) return
        
        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.getDefault())
        isoFormat.timeZone = TimeZone.getTimeZone("UTC")
        val now = isoFormat.format(Date())
        
        // 1. Update the latest position in gps_positions
        val latest = locations.last()
        val latestSpeed = (latest.speed * 3.6).toFloat()
        
        val json = JSONObject()
        json.put("device_id", deviceId)
        json.put("device_name", deviceId)
        json.put("latitude", latest.latitude)
        json.put("longitude", latest.longitude)
        json.put("speed", latestSpeed)
        json.put("accuracy", latest.accuracy)
        json.put("app_status", "Tracking Active")
        json.put("source", "native")
        json.put("is_online", true)
        json.put("updated_at", now)

        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("$supabaseUrl/rest/v1/gps_positions?on_conflict=device_id")
            .addHeader("apikey", supabaseKey)
            .addHeader("Authorization", "Bearer $supabaseKey")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "resolution=merge-duplicates")
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                broadcastDbStatus("Network Error: ${e.message}", true)
            }
            override fun onResponse(call: Call, response: Response) {
                if (response.isSuccessful) {
                    broadcastDbStatus("Synced ${locations.size} points")
                } else {
                    val errorBody = response.body?.string() ?: "Unknown Error"
                    broadcastDbStatus("HTTP ${response.code}: $errorBody", true)
                }
                response.close()
            }
        })
        
        // 2. Batch insert into gps_history
        val historyArray = org.json.JSONArray()
        for (loc in locations) {
            val h = JSONObject()
            h.put("device_id", deviceId)
            h.put("latitude", loc.latitude)
            h.put("longitude", loc.longitude)
            h.put("speed", (loc.speed * 3.6).toFloat())
            h.put("accuracy", loc.accuracy)
            h.put("source", "native")
            
            // Generate timestamp for each location (approximated based on time collected)
            val locTime = isoFormat.format(Date(loc.time))
            h.put("recorded_at", locTime)
            historyArray.put(h)
        }

        val historyBody = historyArray.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val historyRequest = Request.Builder()
            .url("$supabaseUrl/rest/v1/gps_history")
            .addHeader("apikey", supabaseKey)
            .addHeader("Authorization", "Bearer $supabaseKey")
            .addHeader("Content-Type", "application/json")
            .post(historyBody)
            .build()

        client.newCall(historyRequest).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }
}
