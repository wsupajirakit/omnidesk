import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsMongoId } from 'class-validator';

/**
 * [FEAT-20260817-GROUPBULKSTATUS] Body of `PATCH /api/groups/status/bulk`.
 *
 * Shaped after the hooks equivalent (`PATCH /hook/status/bulk`) so the dashboard
 * has one mental model for "tick rows, flip a switch": a list of ids and the
 * target state, applied all-or-nothing.
 *
 * `status` is a real boolean here, unlike `UpdateGroupDto.status` which accepts
 * anything and coerces. A bulk write is not the place to guess what `"maybe"`
 * meant, and the dashboard sends a checkbox value — so an unparsable state is a
 * 400, not a silent `false` across twenty groups.
 * งานหมู่ = ห้ามเดาค่า ผิดทีเดียวโดนทุกกลุ่ม.
 */
export class BulkGroupStatusDto {
  @ApiProperty({
    description:
      'Group ids to change. Every id must be reachable by the caller.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'ids is required' })
  @IsMongoId({ each: true, message: 'invalid group id' })
  ids!: string[];

  @ApiProperty({ description: 'true = active, false = inactive' })
  @IsBoolean()
  status!: boolean;
}
