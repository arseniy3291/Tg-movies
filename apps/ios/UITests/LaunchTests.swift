import XCTest
final class LaunchTests:XCTestCase {
    func testLocalInterfaceStartsWithoutHostedServer() {
        let app = XCUIApplication();app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout:30),"Local server should start the bundled interface")
        XCTAssertTrue(app.webViews.buttons["Поиск"].firstMatch.waitForExistence(timeout:20))
        // WebKit can report a hittable point outside this circular button's clipped corners.
        app.webViews.buttons["Поиск"].firstMatch.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.5)).tap()
        XCTAssertTrue(app.webViews.textFields.firstMatch.waitForExistence(timeout:5))
        let screenshot = XCTAttachment(screenshot:app.screenshot());screenshot.name = "CineGram on iPhone simulator";screenshot.lifetime = .keepAlways;add(screenshot)
    }
}
