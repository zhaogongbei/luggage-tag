import { registerPlugin } from '@capacitor/core';

export interface PrintOptions {
  customerText: string;
  orderNo: string;
  timestamp: string;
}

export interface UsbDevice {
  name: string;
  vendorId: number;
  productId: number;
}

export interface EscPosPlugin {
  print(options: PrintOptions): Promise<{ success: boolean }>;
  getDevices(): Promise<{ devices: UsbDevice[] }>;
}

const EscPos = registerPlugin<EscPosPlugin>('EscPos');
export default EscPos;
