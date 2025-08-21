import { whatsappService } from '../../services/whatsapp';
import { locationController } from './index'; // Import from the index file
import { preferenceController } from '../../controllers/preference';
import { userService } from '../../services/user';
import { logger } from '../../utils/logger';

export class WebhookLocationController {
  /**
   * Handle location-related button responses
   */
  async handleLocationButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void> {
    try {
      logger.info('Location button pressed', { whatsappId, buttonId, buttonTitle });

      switch (buttonId) {
        // Navigation buttons
        case 'next_station':
          await locationController.handleNextStation(whatsappId);
          break;

        case 'load_more_stations':
          await locationController.loadMoreStations(whatsappId);
          break;

        case 'show_all_results':
        case 'show_all_nearby':
          await locationController.showAllNearbyStations(whatsappId);
          break;

        case 'back_to_top_result':
          await this.backToTopResult(whatsappId);
          break;

        // Search modification buttons
        case 'expand_search':
          await this.expandSearchRadius(whatsappId);
          break;

        case 'remove_filters':
          await this.removeFilters(whatsappId);
          break;

        case 'new_search':
          await this.startNewSearch(whatsappId);
          break;

        // Location input buttons
        case 'share_gps_location':
          await this.requestGPSLocation(whatsappId);
          break;

        case 'try_different_address':
          await this.requestAddressInput(whatsappId);
          break;

        case 'location_help':
          await preferenceController.showLocationHelp(whatsappId);
          break;

        // Station action buttons (these will be handled in Phase 4)
        default:
          if (buttonId.startsWith('book_station_')) {
            const stationId = buttonId.replace('book_station_', '');
            await this.handleStationBooking(whatsappId, parseInt(stationId));
          } else if (buttonId.startsWith('station_info_')) {
            const stationId = buttonId.replace('station_info_', '');
            await this.showStationDetails(whatsappId, parseInt(stationId));
          } else {
            logger.warn('Unknown location button', { whatsappId, buttonId });
            await whatsappService.sendTextMessage(
              whatsappId,
              '❓ Unknown option. Please try again or type "help".'
            );
          }
          break;
      }

    } catch (error) {
      logger.error('Failed to handle location button', { whatsappId, buttonId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again.'
      );
    }
  }

  /**
   * Handle location-related list selections
   */
  async handleLocationList(whatsappId: string, listId: string, listTitle: string): Promise<void> {
    try {
      logger.info('Location list selected', { whatsappId, listId, listTitle });

      if (listId.startsWith('select_station_')) {
        const stationId = listId.replace('select_station_', '');
        await this.handleStationSelection(whatsappId, parseInt(stationId));
      } else {
        logger.warn('Unknown location list selection', { whatsappId, listId });
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Unknown selection. Please try again.'
        );
      }

    } catch (error) {
      logger.error('Failed to handle location list', { whatsappId, listId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again.'
      );
    }
  }

  /**
   * Back to top search result
   */
  private async backToTopResult(whatsappId: string): Promise<void> {
    await locationController.showBackToTopResult(whatsappId);
  }

  /**
   * Expand search radius
   */
  private async expandSearchRadius(whatsappId: string): Promise<void> {
    await locationController.expandSearchRadius(whatsappId);
  }

  /**
   * Remove search filters
   */
  private async removeFilters(whatsappId: string): Promise<void> {
    await locationController.removeFilters(whatsappId);
  }

  /**
   * Start new search
   */
  private async startNewSearch(whatsappId: string): Promise<void> {
    // Clear location context
    locationController.clearLocationContext(whatsappId);
    
    await whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Start New Search*\n\nWhere would you like to find charging stations?',
      [
        { id: 'share_gps_location', title: '📱 Share Current Location' },
        { id: 'type_address', title: '⌨️ Type Address' },
        { id: 'recent_searches', title: '🕒 Recent Searches' },
      ],
      '🔍 New Search'
    );
  }

  /**
   * Request GPS location
   */
  private async requestGPSLocation(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📱 *Share Your GPS Location*\n\n' +
      '1️⃣ Tap the 📎 attachment icon\n' +
      '2️⃣ Select "Location"\n' +
      '3️⃣ Choose "Send your current location"\n' +
      '4️⃣ Tap "Send"\n\n' +
      '🎯 This gives the most accurate results!'
    );
  }

  /**
   * Request address input
   */
  private async requestAddressInput(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📝 *Type Your Address*\n\n' +
      'Enter the location where you need charging:\n\n' +
      '*Examples:*\n' +
      '• Connaught Place, Delhi\n' +
      '• Brigade Road, Bangalore\n' +
      '• Sector 18, Noida\n' +
      '• Phoenix Mall, Chennai\n\n' +
      'Just type the address and press send!'
    );
  }

  /**
   * Handle station selection from list
   */
  private async handleStationSelection(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🏢 *Station Selected*\n\nStation ID: ${stationId}\n\nLoading detailed information...`
    );

    // Show station details and booking options
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        'Station selection feature will be enhanced in Phase 4 with full booking capabilities!',
        [
          { id: `book_station_${stationId}`, title: '⚡ Book Now' },
          { id: `station_info_${stationId}`, title: '📋 More Info' },
          { id: 'back_to_list', title: '⬅️ Back to List' },
        ],
        '🏢 Station Options'
      );
    }, 1500);
  }

  /**
   * Handle station booking (placeholder for Phase 4)
   */
  private async handleStationBooking(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ *Booking Station ${stationId}*\n\nPreparing reservation system...\n\nThis feature will be available in Phase 4!`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🚧 Coming Soon: Full booking system with queue management, real-time updates, and payment integration!',
        [
          { id: 'notify_when_ready', title: '🔔 Notify When Ready' },
          { id: 'find_other_stations', title: '🔍 Find Other Stations' },
        ]
      );
    }, 2000);
  }

  /**
   * Show detailed station information
   */
  private async showStationDetails(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📋 *Station Details*\n\nStation ID: ${stationId}\n\nLoading comprehensive information...\n\n` +
      '• Real-time availability\n' +
      '• Pricing details\n' +
      '• Amenities nearby\n' +
      '• User reviews\n' +
      '• Operating hours'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        'Detailed station information will be available in Phase 4!',
        [
          { id: `book_station_${stationId}`, title: '⚡ Book Now' },
          { id: 'get_directions', title: '🗺️ Get Directions' },
          { id: 'back_to_search', title: '⬅️ Back to Search' },
        ]
      );
    }, 2000);
  }
}

export const webhookLocationController = new WebhookLocationController();