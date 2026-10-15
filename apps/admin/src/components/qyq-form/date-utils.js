import dayjs from 'dayjs'

export const getDateShortcuts = (item) => {
  let shortcuts = item.shortcuts

  if (!item.dateValidateData) {
    return shortcuts
  }

  const {
    isBefore = true,
    isShowShortcuts = false,
  } = item.dateValidateData

  if (!shortcuts && isShowShortcuts) {
    const now = dayjs(new Date())
    const textArr = ['近一周', '近一月', '近三月', '近半年']
    const dateArr = isBefore
      ? [
          dayjs(new Date().getTime() - 7 * 24 * 60 * 60 * 1000).format('YYYYMMDD'),
          now.subtract(1, 'months').format('YYYYMMDD'),
          now.subtract(3, 'months').format('YYYYMMDD'),
          now.subtract(6, 'months').format('YYYYMMDD'),
        ]
      : [
          dayjs(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).format('YYYYMMDD'),
          now.add(1, 'months').format('YYYYMMDD'),
          now.add(3, 'months').format('YYYYMMDD'),
          now.add(6, 'months').format('YYYYMMDD'),
        ]

    shortcuts = textArr.map((text, index) => ({
      text,
      value: isBefore
        ? [dateArr[index], dayjs(new Date()).format('YYYYMMDD')]
        : [dayjs(new Date()).format('YYYYMMDD'), dateArr[index]],
    }))
  }

  return shortcuts
}

export const getPickerDisabledDate = (time, item, startOrEndDate) => {
  if (item.disableDate) {
    return item.disableDate(time, item)
  }

  if (!item.dateValidateData) {
    return false
  }

  const {
    isLimitRange = true,
    isBefore = true,
    validateType = 'months',
    validateNumber = 6,
    limitRangeArr = [],
  } = item.dateValidateData

  if (isLimitRange) {
    if (isBefore) {
      if (time.getTime() > new Date().getTime()) {
        return true
      }
    } else if (time.getTime() < new Date().getTime()) {
      return true
    }
  }

  if (limitRangeArr.length) {
    const rangeDateStart = limitRangeArr[0]
    const rangeDateEnd = limitRangeArr[1]
    let startRes = false
    let endRes = false

    if (rangeDateStart) {
      startRes =
        time.getTime() < dayjs().subtract(rangeDateStart.number, rangeDateStart.type).subtract(1, 'day')
    }

    if (rangeDateEnd) {
      endRes = time.getTime() > dayjs().add(rangeDateEnd.number, rangeDateEnd.type)
    }

    if (startRes || endRes) {
      return true
    }
  }

  const startDate = startOrEndDate[item.prop]?.startDate
  const endDate = startOrEndDate[item.prop]?.endDate

  if (startDate && endDate) {
    return (
      time.getTime() > dayjs(startDate).add(validateNumber, validateType) ||
      time.getTime() < dayjs(endDate).subtract(validateNumber, validateType)
    )
  }

  return (
    time.getTime() > dayjs(startDate).add(validateNumber, validateType) ||
    time.getTime() < dayjs(startDate).subtract(validateNumber, validateType)
  )
}
