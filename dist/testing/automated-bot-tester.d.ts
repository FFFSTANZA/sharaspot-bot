export interface TestMessage {
    from: string;
    type: 'text' | 'button' | 'interactive' | 'location';
    text?: {
        body: string;
    };
    interactive?: {
        type: 'button_reply' | 'list_reply';
        button_reply?: {
            id: string;
            title: string;
        };
        list_reply?: {
            id: string;
            title: string;
        };
    };
    location?: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
    };
}
export interface TestScenario {
    name: string;
    description: string;
    userId: string;
    steps: {
        action: string;
        message: TestMessage;
        expectedResponse?: string;
        delay?: number;
    }[];
}
export declare class AutomatedBotTester {
    private testResults;
    runAllTests(): Promise<void>;
    runTestScenario(scenario: TestScenario): Promise<void>;
    private getTestScenarios;
    private createMockRequest;
    private createMockResponse;
    private delay;
    private generateTestReport;
    testComponent(componentName: string): Promise<void>;
    private testUserService;
    private testLocationService;
    private testGeocodingService;
    private testStationSearchService;
}
export declare const automatedBotTester: AutomatedBotTester;
//# sourceMappingURL=automated-bot-tester.d.ts.map