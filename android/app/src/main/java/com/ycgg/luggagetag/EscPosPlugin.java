package com.ycgg.luggagetag;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "EscPos")
public class EscPosPlugin extends Plugin {

    private static final String ACTION_USB_PERMISSION = "com.ycgg.luggagetag.USB_PERMISSION";
    private UsbManager usbManager;
    private PendingIntent permissionIntent;
    private PluginCall pendingCall;
    private String pendingCustomerText;
    private String pendingOrderNo;
    private String pendingTimestamp;

    @Override
    public void load() {
        usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        permissionIntent = PendingIntent.getBroadcast(
            getContext(), 0,
            new Intent(ACTION_USB_PERMISSION),
            PendingIntent.FLAG_IMMUTABLE
        );

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (ACTION_USB_PERMISSION.equals(intent.getAction())) {
                    synchronized (EscPosPlugin.this) {
                        UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                        if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) && device != null) {
                            doPrint(device);
                        } else {
                            if (pendingCall != null) {
                                pendingCall.reject("USB permission denied");
                                pendingCall = null;
                            }
                        }
                    }
                }
            }
        };
        getContext().registerReceiver(
            receiver, new IntentFilter(ACTION_USB_PERMISSION),
            Context.RECEIVER_NOT_EXPORTED
        );
    }

    @PluginMethod
    public void getDevices(PluginCall call) {
        List<JSObject> devices = new ArrayList<>();
        for (UsbDevice device : usbManager.getDeviceList().values()) {
            JSObject obj = new JSObject();
            obj.put("name", device.getProductName() != null ? device.getProductName() : "Unknown");
            obj.put("vendorId", device.getVendorId());
            obj.put("productId", device.getProductId());
            devices.add(obj);
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void print(PluginCall call) {
        String customerText = call.getString("customerText", "");
        String orderNo = call.getString("orderNo", "");
        String timestamp = call.getString("timestamp", "");

        if (customerText.isEmpty()) {
            call.reject("customerText is required");
            return;
        }

        UsbDevice printer = null;
        for (UsbDevice device : usbManager.getDeviceList().values()) {
            int vid = device.getVendorId();
            int pid = device.getProductId();
            if (vid == 0x0416 || vid == 0x0483 || vid == 0x6868 || vid == 0x0493
                || (vid == 0x0FE6 && pid == 0x811E)) {
                printer = device;
                break;
            }
        }

        if (printer == null) {
            call.reject("未找到 USB 热敏打印机，请检查连接");
            return;
        }

        synchronized (this) {
            pendingCall = call;
            pendingCustomerText = customerText;
            pendingOrderNo = orderNo;
            pendingTimestamp = timestamp;

            if (usbManager.hasPermission(printer)) {
                doPrint(printer);
            } else {
                usbManager.requestPermission(printer, permissionIntent);
            }
        }
    }

    private void doPrint(UsbDevice device) {
        try {
            UsbInterface usbInterface = device.getInterface(0);
            UsbEndpoint endpoint = usbInterface.getEndpoint(1);
            if (endpoint == null || endpoint.getDirection() != UsbConstants.USB_DIR_OUT) {
                for (int i = 0; i < usbInterface.getEndpointCount(); i++) {
                    UsbEndpoint ep = usbInterface.getEndpoint(i);
                    if (ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                        endpoint = ep;
                        break;
                    }
                }
            }
            if (endpoint == null) {
                if (pendingCall != null) {
                    pendingCall.reject("无法找到 USB 输出端点");
                    pendingCall = null;
                }
                return;
            }

            UsbDeviceConnection connection = usbManager.openDevice(device);
            if (connection == null) {
                if (pendingCall != null) {
                    pendingCall.reject("无法打开 USB 设备");
                    pendingCall = null;
                }
                return;
            }

            connection.claimInterface(usbInterface, true);

            byte[] init = {0x1B, 0x40};
            byte[] center = {0x1B, 0x61, 0x01};
            byte[] left = {0x1B, 0x61, 0x00};
            byte[] boldOn = {0x1B, 0x45, 0x01};
            byte[] boldOff = {0x1B, 0x45, 0x00};
            byte[] normal = {0x1B, 0x21, 0x00};
            byte[] large = {0x1B, 0x21, 0x30};
            byte[] cut = {0x1D, 0x56, 0x42, 0x01};
            byte[] feed = {0x0A, 0x0A, 0x0A};

            sendBytes(connection, endpoint, init);
            sendBytes(connection, endpoint, feed);
            sendBytes(connection, endpoint, center);
            sendBytes(connection, endpoint, large);
            sendBytes(connection, endpoint, boldOn);
            sendBytes(connection, endpoint, (pendingCustomerText + "\n").getBytes("GBK"));
            sendBytes(connection, endpoint, normal);
            sendBytes(connection, endpoint, boldOff);
            sendBytes(connection, endpoint, feed);
            sendBytes(connection, endpoint, left);
            sendBytes(connection, endpoint, (pendingOrderNo + "\n").getBytes("GBK"));
            sendBytes(connection, endpoint, (pendingTimestamp + "\n").getBytes("GBK"));
            sendBytes(connection, endpoint, feed);
            sendBytes(connection, endpoint, cut);

            connection.releaseInterface(usbInterface);
            connection.close();

            if (pendingCall != null) {
                JSObject result = new JSObject();
                result.put("success", true);
                pendingCall.resolve(result);
                pendingCall = null;
            }
        } catch (Exception e) {
            if (pendingCall != null) {
                pendingCall.reject("打印失败: " + e.getMessage());
                pendingCall = null;
            }
        }
    }

    private void sendBytes(UsbDeviceConnection connection, UsbEndpoint endpoint, byte[] data) {
        int sent = connection.bulkTransfer(endpoint, data, data.length, 2000);
        if (sent < 0) {
            throw new RuntimeException("USB bulk transfer failed, code: " + sent);
        }
    }
}
