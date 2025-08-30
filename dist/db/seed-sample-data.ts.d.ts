declare const sampleOwners: {
    whatsappId: string;
    name: string;
    phoneNumber: string;
    email: string;
    businessName: string;
    businessType: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    isVerified: boolean;
    kycStatus: string;
}[];
declare const sampleStations: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    geohash: string;
    totalPorts: number;
    availablePorts: number;
    connectorTypes: string[];
    maxPowerKw: number;
    pricePerKwh: number;
    ownerWhatsappId: string;
    currentQueueLength: number;
    maxQueueLength: number;
    averageSessionMinutes: number;
    operatingHours: {
        monday: string;
        tuesday: string;
        wednesday: string;
        thursday: string;
        friday: string;
        saturday: string;
        sunday: string;
    };
    amenities: string[];
}[];
declare function seedSampleData(): Promise<void>;
export { seedSampleData, sampleOwners, sampleStations };
//# sourceMappingURL=seed-sample-data.ts.d.ts.map