import { useContext } from "react";
import { CalendarDate, fromDate, toCalendarDate } from "@internationalized/date";
import { ChevronLeft, ChevronRight } from "@untitledui/icons";
import type { DateValue } from "react-aria-components";
import {
  Calendar as AriaCalendar,
  CalendarGrid as AriaCalendarGrid,
  CalendarGridBody as AriaCalendarGridBody,
  CalendarGridHeader as AriaCalendarGridHeader,
  CalendarHeaderCell as AriaCalendarHeaderCell,
  CalendarStateContext,
} from "react-aria-components";
import { useDateFormatter } from "react-aria";
import { Button } from "@/components/base/buttons/button";
import { CalendarCell } from "@/components/application/date-picker/cell";
import type { ChannelDateRange } from "@/hooks/use-channel-date-range";
import { useTimezone } from "@/hooks/use-timezone";

interface ChannelSingleDatePickerProps {
  availableRange: ChannelDateRange;
  value: DateValue | null;
  onChange: (value: DateValue) => void;
}

function toCalDate(date: Date, tz: string): CalendarDate {
  const zoned = fromDate(date, tz);
  return toCalendarDate(zoned);
}

const CalendarTitle = () => {
  const state = useContext(CalendarStateContext);
  const formatter = useDateFormatter({
    month: "short",
    year: "numeric",
    calendar: state!.visibleRange.start.calendar.identifier,
    timeZone: state!.timeZone,
  });
  return formatter.format(state!.visibleRange.start.toDate(state!.timeZone));
};

export function ChannelSingleDatePicker({
  availableRange,
  value,
  onChange,
}: ChannelSingleDatePickerProps) {
  const tz = useTimezone();
  const minDate = toCalDate(availableRange.startDate, tz);
  const maxDate = toCalDate(availableRange.endDate, tz);

  return (
    <AriaCalendar
      aria-label="Select date"
      minValue={minDate}
      maxValue={maxDate}
      value={value}
      onChange={onChange}
      className="flex flex-col gap-2"
    >
      <header className="flex items-center justify-between">
        <Button
          slot="previous"
          iconLeading={ChevronLeft}
          size="sm"
          color="tertiary"
          className="size-7"
        />
        <span className="text-xs font-semibold text-secondary">
          <CalendarTitle />
        </span>
        <Button
          slot="next"
          iconLeading={ChevronRight}
          size="sm"
          color="tertiary"
          className="size-7"
        />
      </header>

      <AriaCalendarGrid weekdayStyle="short" className="w-full">
        <AriaCalendarGridHeader>
          {(day) => (
            <AriaCalendarHeaderCell className="border-b-2 border-transparent p-0">
              <div className="flex size-8 items-center justify-center text-xs font-medium text-tertiary">
                {day.slice(0, 2)}
              </div>
            </AriaCalendarHeaderCell>
          )}
        </AriaCalendarGridHeader>
        <AriaCalendarGridBody className="[&_td]:p-0 [&_tr]:border-b-2 [&_tr]:border-transparent [&_tr:last-of-type]:border-none">
          {(date) => <CalendarCell date={date} />}
        </AriaCalendarGridBody>
      </AriaCalendarGrid>
    </AriaCalendar>
  );
}
